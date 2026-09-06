import { createHash } from 'node:crypto';
// Repository-level tests intentionally inspect local fixture and metadata files.
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { readFile } from 'node:fs/promises';
// Vitest runs the suite; Node's strict assertions retain the existing predicate-based checks.
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import assert from 'node:assert/strict';
import type { IHttpRequestOptions } from 'n8n-workflow';
import { test } from 'vitest';

import { OpenObserveApi } from '../credentials/OpenObserveApi.credentials';
import { normalizeOpenObserveError, redactSensitive } from '../nodes/OpenObserve/shared/errors';
import { collectPaginated } from '../nodes/OpenObserve/shared/pagination';
import { appendQuery, serializeQuery } from '../nodes/OpenObserve/shared/query';
import { toOpenObserveMicroseconds } from '../nodes/OpenObserve/shared/time';
import { openObserveApiRequest } from '../nodes/OpenObserve/shared/transport';
import {
	buildApiPath,
	buildApiV2Path,
	buildApiV2Url,
	buildApiUrl,
	encodePathSegment,
	normalizeBaseUrl,
} from '../nodes/OpenObserve/shared/url';

const fakeNode = {
	id: 'test-node',
	name: 'OpenObserve',
	type: '@blackswampai/n8n-nodes-openobserve.openObserve',
	typeVersion: 1,
	position: [0, 0] as [number, number],
	parameters: {},
};

test('normalizes Cloud, self-hosted, and reverse-proxy base URLs', () => {
	assert.equal(normalizeBaseUrl('https://api.openobserve.ai///'), 'https://api.openobserve.ai');
	assert.equal(normalizeBaseUrl('http://127.0.0.1:5080/'), 'http://127.0.0.1:5080');
	assert.equal(
		normalizeBaseUrl('https://example.test/observability///'),
		'https://example.test/observability',
	);
});

test('rejects unsafe or malformed base URLs', () => {
	for (const value of [
		'',
		'not a URL',
		'ftp://example.test',
		'https://user:secret@example.test',
		'https://example.test?token=secret',
		'https://example.test/#fragment',
	]) {
		assert.throws(() => normalizeBaseUrl(value));
	}
});

test('encodes organization and endpoint segments without path injection', () => {
	assert.equal(encodePathSegment('a/b'), 'a%2Fb');
	assert.equal(
		buildApiPath('team / west', 'streams', 'v1.2'),
		'/api/team%20%2F%20west/streams/v1.2',
	);
	assert.equal(
		buildApiUrl('https://example.test/proxy/', 'team/a', 'streams'),
		'https://example.test/proxy/api/team%2Fa/streams',
	);
	assert.throws(() => buildApiPath('', 'streams'), /Organization ID is required/);
	assert.throws(() => buildApiPath('..', 'streams'), /dot segment/);
	assert.throws(() => buildApiPath('team', '.'), /dot segment/);
});

test('constructs explicit v2 paths without changing the unversioned default', () => {
	assert.equal(buildApiPath('team/a', 'alerts'), '/api/team%2Fa/alerts');
	assert.equal(buildApiPath('team.example', 'streams'), '/api/team.example/streams');
	assert.equal(
		buildApiV2Path('team/a', 'alerts', 'alert.one'),
		'/api/v2/team%2Fa/alerts/alert.one',
	);
	assert.equal(
		buildApiV2Url('https://example.test/reverse/proxy///', 'team/a', 'alerts'),
		'https://example.test/reverse/proxy/api/v2/team%2Fa/alerts',
	);
});

test('applies Basic authentication and rewrites the harmless credential test path', async () => {
	const credential = new OpenObserveApi();
	const authenticate = credential.authenticate as unknown as (...args: unknown[]) => Promise<{
		baseURL?: string;
		url?: string;
		auth?: { username: string; password: string; sendImmediately: boolean };
		headers?: unknown;
	}>;
	const request = await authenticate(
		{
			baseUrl: 'https://example.test/proxy///',
			organizationId: 'team/a',
			accountIdentifier: 'service@example.test',
			secret: 'test-token-value',
		},
		{ url: '/api/__n8n_openobserve_credential_test__/streams' },
	);
	assert.equal(request.baseURL, 'https://example.test/proxy');
	assert.equal(request.url, '/api/team%2Fa/streams');
	assert.deepEqual(request.auth, {
		username: 'service@example.test',
		password: 'test-token-value',
		sendImmediately: true,
	});
	assert.equal(request.headers, undefined);
});

test('credential fields are required, neutral, and never default to Cloud', () => {
	const credential = new OpenObserveApi();
	for (const name of ['baseUrl', 'organizationId', 'accountIdentifier', 'secret']) {
		assert.equal(credential.properties.find((property) => property.name === name)?.required, true);
	}
	assert.equal(credential.properties.find((property) => property.name === 'baseUrl')?.default, '');
	assert.equal(credential.test.request.baseURL, 'https://openobserve.invalid');
});

test('redacts credentials, authorization, URL secrets, and email addresses', () => {
	const unsafe =
		'service@example.test token-value Authorization: Basic abc123 https://user:pass@example.test/path?token=query-secret';
	const safe = redactSensitive(unsafe, ['service@example.test', 'token-value']);
	for (const secret of [
		'service@example.test',
		'token-value',
		'abc123',
		'user:pass',
		'query-secret',
	]) {
		assert.equal(safe.includes(secret), false);
	}
});

test('redaction tolerates circular and BigInt payloads and covers token key variants', () => {
	const circular: {
		api_key: string;
		access_token: string;
		count: bigint;
		url: string;
		self?: unknown;
	} = {
		api_key: 'api-key-value',
		access_token: 'access-token-value',
		count: 10n,
		url: 'https://example.test/path?api_key=query-key&access_token=query-token',
	};
	circular.self = circular;
	const safe = redactSensitive(circular);
	assert.match(safe, /Circular/);
	assert.match(safe, /10/);
	for (const secret of ['api-key-value', 'access-token-value', 'query-key', 'query-token']) {
		assert.equal(safe.includes(secret), false);
	}
});

test('maps HTTP and connection failures to safe n8n errors', () => {
	for (const [status, expected] of [
		[400, 'rejected'],
		[401, 'authentication failed'],
		[403, 'denied access'],
		[404, 'not found'],
	] as Array<[number, string]>) {
		const error = normalizeOpenObserveError(
			fakeNode,
			{ statusCode: status, message: `failure for service@example.test using token-value` },
			{ secrets: ['service@example.test', 'token-value'] },
		);
		assert.equal('httpCode' in error ? error.httpCode : undefined, String(status));
		assert.match(error.message, new RegExp(expected, 'i'));
		assert.equal(String(error.description).includes('token-value'), false);
	}

	const connection = normalizeOpenObserveError(
		fakeNode,
		new Error('connect ECONNREFUSED token-value'),
		{
			secrets: ['token-value'],
		},
	);
	assert.match(connection.message, /Unable to connect to OpenObserve/);
	assert.equal(String(connection.description).includes('token-value'), false);
});

test('preserves safe HTTP response detail from Error objects', () => {
	const upstream = Object.assign(new Error('Request failed with status code 400'), {
		statusCode: 400,
		response: {
			data: { message: 'Alert destination or workflows is required' },
			config: { headers: { Authorization: 'Basic credential-value' } },
		},
	});
	const normalized = normalizeOpenObserveError(fakeNode, upstream, {
		secrets: ['credential-value'],
		itemIndex: 2,
	});
	assert.match(String(normalized.description), /Alert destination or workflows is required/);
	assert.equal(String(normalized.description).includes('credential-value'), false);
	assert.equal(String(normalized.description).includes('config'), false);
	assert.equal((normalized as unknown as { context: { itemIndex: number } }).context.itemIndex, 2);
});

test('converts ISO, Date, and numeric values to safe microseconds', () => {
	const instant = '2026-09-04T12:00:00.123Z';
	assert.equal(toOpenObserveMicroseconds(instant), Date.parse(instant) * 1_000);
	assert.equal(toOpenObserveMicroseconds(new Date(instant)), Date.parse(instant) * 1_000);
	assert.equal(toOpenObserveMicroseconds(1_000), 1_000_000);
	assert.equal(toOpenObserveMicroseconds(1_000, { numericUnit: 'seconds' }), 1_000_000_000);
	assert.equal(toOpenObserveMicroseconds(1_000, { numericUnit: 'microseconds' }), 1_000);
	assert.throws(() => toOpenObserveMicroseconds('invalid', { itemIndex: 3 }), /item 3/);
	assert.throws(() => toOpenObserveMicroseconds(Number.MAX_SAFE_INTEGER), /outside/);
	assert.throws(() => toOpenObserveMicroseconds(-1), /outside/);
});

test('serializes repeated Prometheus parameters safely', () => {
	assert.equal(
		serializeQuery({
			match: ['up{job="api"}', 'process_cpu_seconds_total'],
			limit: 10,
			empty: undefined,
		}),
		'match=up%7Bjob%3D%22api%22%7D&match=process_cpu_seconds_total&limit=10',
	);
	assert.equal(
		appendQuery('/series?start=1', { match: ['up', 'down'] }),
		'/series?start=1&match=up&match=down',
	);
});

test('Return All traverses pages without a finite limit and stops on empty pages', async () => {
	const calls: Array<[number, number | undefined]> = [];
	const all = await collectPaginated({
		returnAll: true,
		initialCursor: 0,
		fetchPage: async (offset, remaining) => {
			calls.push([offset, remaining]);
			if (offset === 4) return { items: [], nextCursor: 6 };
			return { items: [offset + 1, offset + 2], nextCursor: offset + 2 };
		},
	});
	assert.deepEqual(all, [1, 2, 3, 4]);
	assert.deepEqual(calls, [
		[0, undefined],
		[2, undefined],
		[4, undefined],
	]);
});

test('limited mode truncates one page and validates limit only in limited mode', async () => {
	let calls = 0;
	const onePage = await collectPaginated({
		returnAll: false,
		limit: 2,
		initialCursor: 'first',
		fetchPage: async (_cursor, remaining) => {
			calls += 1;
			assert.equal(remaining, 2);
			return { items: ['a', 'b', 'c'], nextCursor: 'opaque-next' };
		},
	});
	assert.deepEqual(onePage, ['a', 'b']);
	assert.equal(calls, 1);
	await assert.rejects(
		collectPaginated({
			returnAll: false,
			limit: 0,
			initialCursor: 0,
			fetchPage: async () => ({ items: [] }),
		}),
		/positive safe integer/,
	);
	await assert.doesNotReject(
		collectPaginated({
			returnAll: true,
			limit: 0,
			initialCursor: 0,
			fetchPage: async () => ({ items: [] }),
		} as never),
	);
});

test('limited mode spans capped pages, passes decreasing remaining, and stops exactly', async () => {
	const calls: Array<[number, number | undefined]> = [];
	const result = await collectPaginated({
		returnAll: false,
		limit: 5,
		initialCursor: 0,
		fetchPage: async (cursor, remaining) => {
			calls.push([cursor, remaining]);
			return { items: [cursor + 1, cursor + 2], nextCursor: cursor + 2 };
		},
	});
	assert.deepEqual(result, [1, 2, 3, 4, 5]);
	assert.deepEqual(calls, [
		[0, 5],
		[2, 3],
		[4, 1],
	]);
});

test('limited mode returns early when the endpoint is exhausted', async () => {
	const calls: Array<[string, number | undefined]> = [];
	const result = await collectPaginated({
		returnAll: false,
		limit: 5,
		initialCursor: 'first',
		fetchPage: async (cursor, remaining) => {
			calls.push([cursor, remaining]);
			return cursor === 'first' ? { items: ['a', 'b'], nextCursor: 'last' } : { items: ['c'] };
		},
	});
	assert.deepEqual(result, ['a', 'b', 'c']);
	assert.deepEqual(calls, [
		['first', 5],
		['last', 3],
	]);
});

test('pagination detects primitive and logical object cursor loops and enforces max pages', async () => {
	await assert.rejects(
		collectPaginated({
			returnAll: true,
			initialCursor: 'same',
			fetchPage: async () => ({ items: ['a'], nextCursor: 'same' }),
		}),
		/did not advance/,
	);
	await assert.rejects(
		collectPaginated({
			returnAll: true,
			initialCursor: { page: 1 },
			cursorKey: (cursor) => String(cursor.page),
			fetchPage: async () => ({ items: ['a'], nextCursor: { page: 1 } }),
		}),
		/did not advance/,
	);
	await assert.rejects(
		collectPaginated({
			returnAll: true,
			initialCursor: 0,
			maxPages: 2,
			fetchPage: async (cursor) => ({ items: [cursor], nextCursor: cursor + 1 }),
		}),
		/maximum of 2 pages/,
	);
});

test('transport builds authenticated unversioned and v2 requests without retries', async () => {
	const requests: Array<{
		credentialType: string;
		request: IHttpRequestOptions;
		context: unknown;
	}> = [];
	const context = {
		getCredentials: async (name: string) => {
			assert.equal(name, 'openObserveApi');
			return {
				baseUrl: 'https://example.test/proxy///',
				organizationId: 'team/a',
				accountIdentifier: 'service@example.test',
				secret: 'token-value',
			};
		},
		getNode: () => fakeNode,
		helpers: {
			httpRequestWithAuthentication: async function (
				this: unknown,
				credentialType: string,
				request: IHttpRequestOptions,
			) {
				requests.push({ credentialType, request, context: this });
				return { ok: true };
			},
		},
	};

	await openObserveApiRequest.call(context as never, {
		pathSegments: ['streams'],
		query: { match: ['up', 'down'] },
	});
	await openObserveApiRequest.call(context as never, {
		apiPathMode: 'v2',
		method: 'POST',
		pathSegments: ['alerts', 'alert.one'],
		headers: { Accept: 'application/octet-stream', 'X-Request-Mode': 'explicit' },
		body: Buffer.from('binary'),
		encoding: 'arraybuffer',
		returnFullResponse: true,
	});

	assert.equal(requests.length, 2);
	assert.equal(requests[0].credentialType, 'openObserveApi');
	assert.equal(requests[0].request.url, 'https://example.test/proxy/api/team%2Fa/streams');
	assert.deepEqual(requests[0].request.qs?.match, ['up', 'down']);
	assert.equal(requests[0].request.arrayFormat, 'repeat');
	assert.equal(requests[0].request.json, true);
	assert.equal(
		requests[1].request.url,
		'https://example.test/proxy/api/v2/team%2Fa/alerts/alert.one',
	);
	assert.equal(requests[1].request.method, 'POST');
	assert.deepEqual(requests[1].request.headers, {
		Accept: 'application/octet-stream',
		'X-Request-Mode': 'explicit',
	});
	const binaryBody = requests[1].request.body;
	assert.ok(Buffer.isBuffer(binaryBody));
	assert.equal(binaryBody.toString(), 'binary');
	assert.equal(requests[1].request.encoding, 'arraybuffer');
	assert.equal(requests[1].request.json, false);
	assert.equal(requests[1].request.returnFullResponse, true);
});

test('transport normalizes errors with item context and makes no retry attempt', async () => {
	let attempts = 0;
	const context = {
		getCredentials: async () => ({
			baseUrl: 'https://example.test',
			organizationId: 'default',
			accountIdentifier: 'service@example.test',
			secret: 'token-value',
		}),
		getNode: () => fakeNode,
		helpers: {
			httpRequestWithAuthentication: async () => {
				attempts += 1;
				throw {
					statusCode: 401,
					message:
						'Authorization: Basic exposed service@example.test token-value https://example.test?api_key=query-secret',
				};
			},
		},
	};

	await assert.rejects(
		openObserveApiRequest.call(context as never, { pathSegments: ['streams'], itemIndex: 4 }),
		(error: unknown) => {
			const caught = error as {
				httpCode: string;
				context: { itemIndex: number };
				message: string;
				description: string;
			};
			assert.equal(caught.httpCode, '401');
			assert.equal(caught.context.itemIndex, 4);
			const rendered = `${caught.message} ${caught.description}`;
			for (const secret of [
				'service@example.test',
				'token-value',
				'query-secret',
				'Basic exposed',
			]) {
				assert.equal(rendered.includes(secret), false);
			}
			return true;
		},
	);
	assert.equal(attempts, 1);
});

test('transport redacts caller-supplied destination header values from API errors', async () => {
	const customHeaderSecret = 'custom-webhook-secret-value';
	const context = {
		getCredentials: async () => ({
			baseUrl: 'https://example.test',
			organizationId: 'default',
			accountIdentifier: 'service@example.test',
			secret: 'credential-secret',
		}),
		getNode: () => fakeNode,
		helpers: {
			httpRequestWithAuthentication: async () => {
				throw { statusCode: 400, message: `Invalid header ${customHeaderSecret}` };
			},
		},
	};

	await assert.rejects(
		openObserveApiRequest.call(context as never, {
			method: 'POST',
			pathSegments: ['alerts', 'destinations'],
			sensitiveValues: [customHeaderSecret],
			itemIndex: 7,
		}),
		(error: unknown) => {
			const caught = error as {
				message: string;
				description: string;
				context: { itemIndex: number };
			};
			assert.equal(`${caught.message} ${caught.description}`.includes(customHeaderSecret), false);
			assert.match(`${caught.message} ${caught.description}`, /REDACTED/);
			assert.equal(caught.context.itemIndex, 7);
			return true;
		},
	);
});

test('transport preserves actionable local validation errors with item context', async () => {
	let attempts = 0;
	const cases = [
		{
			baseUrl: 'ftp://service@example.test:token-value@invalid',
			organizationId: 'default',
			pathSegments: ['streams'],
			expected: /HTTP or HTTPS/,
		},
		{
			baseUrl: 'https://example.test',
			organizationId: '',
			pathSegments: ['streams'],
			expected: /Organization ID is required/,
		},
		{
			baseUrl: 'https://example.test',
			organizationId: 'default',
			pathSegments: ['.'],
			expected: /Path segment must not be a dot segment/,
		},
	];

	for (const testCase of cases) {
		const context = {
			getCredentials: async () => ({
				baseUrl: testCase.baseUrl,
				organizationId: testCase.organizationId,
				accountIdentifier: 'service@example.test',
				secret: 'token-value',
			}),
			getNode: () => fakeNode,
			helpers: {
				httpRequestWithAuthentication: async () => {
					attempts += 1;
				},
			},
		};

		await assert.rejects(
			openObserveApiRequest.call(context as never, {
				pathSegments: testCase.pathSegments,
				itemIndex: 7,
			}),
			(error: unknown) => {
				const caught = error as {
					message: string;
					description?: string;
					context: { itemIndex: number };
				};
				assert.match(caught.message, testCase.expected);
				assert.doesNotMatch(caught.message, /Unable to connect/);
				assert.equal(caught.context.itemIndex, 7);
				assert.doesNotMatch(`${caught.message} ${caught.description ?? ''}`, /token-value/);
				return true;
			},
		);
	}

	assert.equal(attempts, 0);
});

test('registers credentials and documents official icon provenance and independence', async () => {
	const packageJson = JSON.parse(
		await readFile(new URL('../package.json', import.meta.url), 'utf8'),
	);
	assert.deepEqual(packageJson.n8n.credentials, ['dist/credentials/OpenObserveApi.credentials.js']);
	const [light, dark, triggerLight, triggerDark, provenance, readme] = await Promise.all([
		readFile(new URL('../nodes/OpenObserve/openobserve.svg', import.meta.url), 'utf8'),
		readFile(new URL('../nodes/OpenObserve/openobserve.dark.svg', import.meta.url), 'utf8'),
		readFile(new URL('../nodes/OpenObserveTrigger/openobserve.svg', import.meta.url), 'utf8'),
		readFile(new URL('../nodes/OpenObserveTrigger/openobserve.dark.svg', import.meta.url), 'utf8'),
		readFile(new URL('../docs/logo.md', import.meta.url), 'utf8'),
		readFile(new URL('../README.md', import.meta.url), 'utf8'),
	]);
	assert.equal(light, dark);
	assert.equal(triggerLight, light);
	assert.equal(triggerDark, light);
	assert.equal(
		createHash('sha256').update(light).digest('hex'),
		'888491dc3e61cb0b2dd069d844c92ea0098197884176e2abb9db3570d764022f',
	);
	assert.match(provenance, /githubusercontent\.com\/openobserve\/openobserve\/c651f43f/);
	assert.match(provenance, /o2_logo\.svg/);
	assert.match(
		readme,
		/not affiliated with, endorsed by, sponsored by, or maintained by OpenObserve/,
	);
});

test('compose healthcheck uses the distroless-compatible native OpenObserve probe', async () => {
	const compose = await readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8');
	const healthcheck = compose.match(/healthcheck:\n([\s\S]*?)\n[ ]{4}restart:/)?.[1];
	assert.ok(healthcheck);
	assert.match(healthcheck, /test: \['CMD', '\/openobserve', 'node', 'list'\]/);
	assert.doesNotMatch(healthcheck, /curl|CMD-SHELL|\bsh\b/);
});
