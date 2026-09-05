// Guarded repository integration fixture intentionally uses Node-only facilities.
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import process from 'node:process';
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { setTimeout as delay } from 'node:timers/promises';
import type {
	IExecuteFunctions,
	IHttpRequestOptions,
	INode,
	INodeExecutionData,
} from 'n8n-workflow';
import { describe, expect, it } from 'vitest';
import { ingestManyLogs } from '../nodes/OpenObserve/resources/log/execute';
import { executeMetric } from '../nodes/OpenObserve/resources/metric/execute';
import { executeSearch } from '../nodes/OpenObserve/resources/search/execute';
import { executeStreamItem, getManyStreams } from '../nodes/OpenObserve/resources/stream/execute';
import { executeTrace } from '../nodes/OpenObserve/resources/trace/execute';

const live = process.env.OPENOBSERVE_LIVE === '1' ? describe : describe.skip;
const baseUrl = process.env.OPENOBSERVE_BASE_URL ?? 'http://127.0.0.1:5080';
const organizationId = process.env.OPENOBSERVE_ORG ?? 'default';
const rawRunId = process.env.OPENOBSERVE_LIVE_RUN_ID ?? `pid_${process.pid}`;
const runId = rawRunId
	.toLowerCase()
	.replace(/[^a-z0-9]/g, '_')
	.replace(/_+/g, '_')
	.slice(0, 24);
const logStream = `n8n_b3_${runId}_logs`;
const metricName = `n8n_b3_${runId}_metric`;
const traceStream = `n8n_b3_${runId}_traces`;
const credentials = {
	baseUrl,
	organizationId,
	accountIdentifier: 'root@example.test',
	secret: 'OpenObserve-Local-Test-Only-9x!',
};
const fakeNode: INode = {
	id: 'b3-live',
	name: 'OpenObserve',
	type: '@blackswampai/n8n-nodes-openobserve.openObserve',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

function guard(): void {
	const url = new URL(baseUrl);
	if (
		!['127.0.0.1', '::1', 'localhost'].includes(url.hostname) ||
		organizationId !== 'default' ||
		!runId
	)
		throw new Error('Batch 3 live tests require loopback and disposable org default');
}
async function request(options: IHttpRequestOptions): Promise<unknown> {
	const url = new URL(options.url);
	for (const [key, raw] of Object.entries(options.qs ?? {}))
		for (const value of Array.isArray(raw) ? raw : [raw])
			if (value !== undefined) url.searchParams.append(key, String(value));
	const response = await fetch(url, {
		method: options.method,
		headers: {
			Authorization: `Basic ${Buffer.from(`${credentials.accountIdentifier}:${credentials.secret}`).toString('base64')}`,
			...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
		},
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
		signal: AbortSignal.timeout(10_000),
	});
	const text = await response.text();
	const body = text ? (JSON.parse(text) as unknown) : {};
	if (!response.ok) throw { statusCode: response.status, message: text };
	return body;
}
function context(
	parameters: Record<string, unknown>,
	input: INodeExecutionData[] = [],
): IExecuteFunctions {
	return {
		getCredentials: async () => credentials,
		getNodeParameter: (name: string, _item: number, fallback?: unknown) =>
			parameters[name] ?? fallback,
		getInputData: () => input,
		getNode: () => fakeNode,
		continueOnFail: () => false,
		helpers: {
			httpRequestWithAuthentication: async (_name: string, options: IHttpRequestOptions) =>
				request(options),
		},
	} as unknown as IExecuteFunctions;
}
async function remove(name: string, type: 'logs' | 'metrics' | 'traces'): Promise<void> {
	try {
		await executeStreamItem(
			context({ streamType: type, streamName: name, confirmDestructive: true, deleteAll: false }),
			'delete',
			0,
		);
	} catch {
		/* exact owned stream may be absent */
	}
}
async function waitFor(
	name: string,
	type: 'logs' | 'metrics' | 'traces',
	present = true,
): Promise<void> {
	for (let n = 0; n < 30; n++) {
		const found = (
			await getManyStreams(
				context({ returnAll: true, streamType: type, keyword: name, sort: 'name' }),
			)
		).some((item) => item.json.name === name);
		if (found === present) return;
		await delay(100);
	}
	throw new Error(`Owned ${type} stream ${name} did not reach expected state`);
}

async function seedMetrics(): Promise<void> {
	await request({
		method: 'POST',
		url: `${baseUrl}/api/${organizationId}/ingest/metrics/_json`,
		body: [
			{ __name__: metricName, __type__: 'gauge', run: runId, value: 7 },
			{ __name__: metricName, __type__: 'gauge', run: runId, value: 8 },
		],
	});
}

async function seedEmptyTraceStream(): Promise<void> {
	await request({
		method: 'POST',
		url: `${baseUrl}/api/${organizationId}/streams/${traceStream}`,
		qs: { type: 'traces' },
		body: { fields: [], settings: {} },
	});
}

live('pinned OpenObserve v0.92.2 Batch 3 flow', () => {
	it('searches logs, queries metrics, checks trace reads, and cleans exact streams', async () => {
		guard();
		for (const [name, type] of [
			[logStream, 'logs'],
			[metricName, 'metrics'],
			[traceStream, 'traces'],
		] as const) {
			await remove(name, type);
			await waitFor(name, type, false);
		}
		const now = Date.now();
		const start = new Date(now - 60_000).toISOString();
		const end = new Date(now + 60_000).toISOString();
		try {
			const logInput = [
				{ json: { b3_tag: runId, message: 'one' } },
				{ json: { b3_tag: runId, message: 'two' } },
			];
			await ingestManyLogs(context({ streamName: logStream }, logInput), logInput);
			await waitFor(logStream, 'logs');
			let rows: INodeExecutionData[] = [];
			for (let n = 0; n < 20 && rows.length < 2; n++) {
				rows = await executeSearch(
					context({
						sql: `select * from ${logStream}`,
						startTime: start,
						endTime: end,
						offset: 0,
						limit: 10,
						streamType: 'logs',
					}),
					'query',
					0,
				);
				if (rows.length < 2) await delay(100);
			}
			expect(rows).toHaveLength(2);
			for (const outputMode of ['csv', 'md_table']) {
				const formatted = await executeSearch(
					context({
						sql: `select * from ${logStream}`,
						startTime: start,
						endTime: end,
						offset: 0,
						limit: 10,
						streamType: 'logs',
						outputMode,
					}),
					'query',
					0,
				);
				expect(typeof formatted[0].json.data).toBe('string');
			}
			const values = await executeSearch(
				context({
					streamName: logStream,
					fields: 'b3_tag',
					startTime: start,
					endTime: end,
					offset: 0,
					limit: 10,
					streamType: 'logs',
				}),
				'getFieldValues',
				0,
			);
			expect(JSON.stringify(values[0].json)).toContain(runId);
			const around = await executeSearch(
				context({
					streamName: logStream,
					aroundRecordJson: JSON.stringify(rows[0].json),
					limit: 10,
				}),
				'searchAround',
				0,
			);
			expect(JSON.stringify(around[0].json)).toContain(runId);
			await seedMetrics();
			await waitFor(metricName, 'metrics');
			await delay(200);
			const common = { selectors: `{__name__="${metricName}"}`, startTime: start, endTime: end };
			const instant = await executeMetric(
				context({ promql: `${metricName}{run="${runId}"}` }),
				'instantQuery',
				0,
			);
			expect(instant.length).toBeGreaterThan(0);
			const range = await executeMetric(
				context({ promql: metricName, startTime: start, endTime: end, step: '15s' }),
				'rangeQuery',
				0,
			);
			expect(range.length).toBeGreaterThan(0);
			for (const [op, extra] of [
				['getMetadata', { metricName, limit: 100 }],
				['getLabels', common],
				['getLabelValues', { ...common, labelName: 'run' }],
				['findSeries', common],
			] as const) {
				const result = await executeMetric(context({ ...extra, rawResponse: true }), op, 0);
				expect(result[0].json.status).toBe('success');
			}
			await seedEmptyTraceStream();
			await waitFor(traceStream, 'traces');
			await expect(
				executeTrace(
					context({
						streamName: traceStream,
						startTime: start,
						endTime: end,
						offset: 0,
						limit: 10,
					}),
					'getLatest',
					0,
				),
			).rejects.toThrow(/OpenObserve rejected/);
			await expect(
				executeTrace(
					context({
						streamName: traceStream,
						traceId: '0123456789abcdef0123456789abcdef',
						startTime: start,
						endTime: end,
					}),
					'getDag',
					0,
				),
			).rejects.toThrow();
		} finally {
			await remove(logStream, 'logs');
			await remove(metricName, 'metrics');
			await remove(traceStream, 'traces');
			await waitFor(logStream, 'logs', false);
			await waitFor(metricName, 'metrics', false);
			await waitFor(traceStream, 'traces', false);
		}
	});
});
