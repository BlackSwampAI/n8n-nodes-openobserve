// Repository-level integration tests intentionally use Node process/timer facilities.
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { setTimeout as delay } from 'node:timers/promises';
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import process from 'node:process';
import type {
	IExecuteFunctions,
	IHttpRequestOptions,
	INode,
	INodeExecutionData,
} from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { ingestManyLogs } from '../nodes/OpenObserve/resources/log/execute';
import { executeStreamItem, getManyStreams } from '../nodes/OpenObserve/resources/stream/execute';

const live = process.env.OPENOBSERVE_LIVE === '1' ? describe : describe.skip;
const baseUrl = process.env.OPENOBSERVE_BASE_URL ?? 'http://127.0.0.1:5080';
const organizationId = process.env.OPENOBSERVE_ORG ?? 'default';
const rawRunId = process.env.OPENOBSERVE_LIVE_RUN_ID ?? `pid-${process.pid}`;
const runId = rawRunId
	.toLowerCase()
	.replace(/[^a-z0-9]/g, '_')
	.replace(/_+/g, '_')
	.slice(0, 32);
const credentials = {
	baseUrl,
	organizationId,
	accountIdentifier: 'root@example.test',
	secret: 'OpenObserve-Local-Test-Only-9x!',
};
const inferredStream = `n8n_batch2_live_${runId}_inferred`;
const fakeNode: INode = {
	id: 'batch-2-live',
	name: 'OpenObserve Live',
	type: '@blackswampai/n8n-nodes-openobserve.openObserve',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

async function request(options: IHttpRequestOptions): Promise<unknown> {
	const url = new URL(options.url);
	for (const [key, value] of Object.entries(options.qs ?? {})) {
		for (const item of Array.isArray(value) ? value : [value]) {
			if (item !== undefined) url.searchParams.append(key, String(item));
		}
	}
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
		getNodeParameter: (name: string) => parameters[name],
		getInputData: () => input,
		getNode: () => fakeNode,
		continueOnFail: () => false,
		helpers: {
			httpRequestWithAuthentication: async (_name: string, options: IHttpRequestOptions) =>
				request(options),
		},
	} as unknown as IExecuteFunctions;
}

async function removeOwnedStream(name: string): Promise<void> {
	try {
		await executeStreamItem(
			context({ streamType: 'logs', streamName: name, confirmDestructive: true, deleteAll: false }),
			'delete',
			0,
		);
	} catch {
		// A missing owned stream is the expected clean starting/ending state.
	}
}

function assertDisposableTarget(): void {
	const url = new URL(baseUrl);
	if (!['127.0.0.1', '::1', 'localhost'].includes(url.hostname)) {
		throw new Error('Live Batch 2 tests only allow a loopback OpenObserve Base URL');
	}
	if (organizationId !== 'default') {
		throw new Error('Live Batch 2 tests only allow the disposable local organization "default"');
	}
	if (!runId) throw new Error('OPENOBSERVE_LIVE_RUN_ID must contain a letter or number');
}

async function expectOwnedStreamsAbsent(): Promise<void> {
	for (const name of [inferredStream]) {
		let present = true;
		for (let attempt = 0; attempt < 20 && present; attempt++) {
			const listed = await getManyStreams(
				context({ returnAll: true, streamType: 'logs', keyword: name, sort: 'name' }),
			);
			present = listed.some((item) => item.json.name === name);
			if (present) await delay(100);
		}
		expect(present).toBe(false);
	}
}

async function waitForOwnedStream(name: string): Promise<INodeExecutionData> {
	for (let attempt = 0; attempt < 20; attempt++) {
		const listed = await getManyStreams(
			context({ returnAll: false, limit: 1, streamType: 'logs', keyword: name, sort: 'name' }),
		);
		const found = listed.find((item) => item.json.name === name);
		if (found) return found;
		await delay(100);
	}
	throw new Error(`Owned stream ${name} did not appear within the live-test timeout`);
}

live('pinned OpenObserve v0.92.2 Stream and Log flow', () => {
	it('ingests, inspects, updates, deletes fields, and cleans up', async () => {
		assertDisposableTarget();
		await removeOwnedStream(inferredStream);
		try {
			const ingested = await ingestManyLogs(
				context({ streamName: inferredStream }, [
					{ json: { batch2_message: 'first', batch2_code: 1, batch2_disposable: 'remove' } },
					{ json: { batch2_message: 'second', batch2_code: 2, batch2_disposable: 'remove' } },
				]),
				[
					{ json: { batch2_message: 'first', batch2_code: 1, batch2_disposable: 'remove' } },
					{ json: { batch2_message: 'second', batch2_code: 2, batch2_disposable: 'remove' } },
				],
			);
			expect(ingested.json).toMatchObject({ successful: 2, failed: 0 });

			const listed = await waitForOwnedStream(inferredStream);
			expect(listed.json.name).toBe(inferredStream);

			const schema = await executeStreamItem(
				context({ streamType: 'logs', streamName: inferredStream, keyword: '' }),
				'getSchema',
				0,
			);
			expect(JSON.stringify(schema.json)).toContain('batch2_message');

			await executeStreamItem(
				context({
					streamType: 'logs',
					streamName: inferredStream,
					settingsJson: '{"data_retention":1}',
				}),
				'updateSettings',
				0,
			);
			await executeStreamItem(
				context({
					streamType: 'logs',
					streamName: inferredStream,
					fields: 'batch2_disposable',
					confirmDestructive: true,
				}),
				'deleteFields',
				0,
			);
			const updated = await executeStreamItem(
				context({ streamType: 'logs', streamName: inferredStream, keyword: '' }),
				'getSchema',
				0,
			);
			expect(updated.json.settings).toMatchObject({ data_retention: 1 });
			expect(JSON.stringify(updated.json)).not.toContain('batch2_disposable');
		} finally {
			await removeOwnedStream(inferredStream);
			await expectOwnedStreamsAbsent();
		}
	});
});
