/* eslint-disable @n8n/community-nodes/no-restricted-imports -- Guarded local OSS fixture. */
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import type { IExecuteFunctions, IHttpRequestOptions, INode } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';
import { executePipeline } from '../nodes/OpenObserve/resources/pipeline/execute';

const live = process.env.OPENOBSERVE_LIVE === '1' ? describe : describe.skip;
const baseUrl = process.env.OPENOBSERVE_BASE_URL ?? 'http://127.0.0.1:5080';
const organizationId = process.env.OPENOBSERVE_ORG ?? 'default';
const suffix = (process.env.OPENOBSERVE_LIVE_RUN_ID ?? `pid_${process.pid}`)
	.toLowerCase()
	.replace(/[^a-z0-9]/g, '_')
	.slice(0, 20);
const prefix = `n8n_b7_${suffix}`;
const credentials = {
	baseUrl,
	organizationId,
	accountIdentifier: 'root@example.test',
	secret: 'OpenObserve-Local-Test-Only-9x!',
};
const node: INode = {
	id: 'pipeline-live',
	name: 'OpenObserve',
	type: 'openObserve',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};
function guard() {
	if (
		!['127.0.0.1', '::1', 'localhost'].includes(new URL(baseUrl).hostname) ||
		organizationId !== 'default'
	)
		throw new Error('Batch 7 live tests require loopback OpenObserve and org default');
}
async function request(options: IHttpRequestOptions): Promise<unknown> {
	const url = new URL(options.url);
	for (const [key, rawValue] of Object.entries(options.qs ?? {}))
		for (const value of Array.isArray(rawValue) ? rawValue : [rawValue])
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
const raw = (method: IHttpRequestOptions['method'], path: string, body?: unknown) =>
	request({ method, url: `${baseUrl}${path}`, body: body as IHttpRequestOptions['body'] });
function context(parameters: Record<string, unknown>): IExecuteFunctions {
	return {
		getCredentials: async () => credentials,
		getNode: () => node,
		getNodeParameter: (name: string, _index: number, fallback: unknown) =>
			parameters[name] ?? fallback,
		helpers: {
			httpRequestWithAuthentication: async (_name: string, options: IHttpRequestOptions) =>
				request(options),
		},
	} as unknown as IExecuteFunctions;
}
const streamNode = (id: string, ioType: 'input' | 'output', streamName: string) => ({
	id,
	io_type: ioType,
	position: { x: ioType === 'input' ? 0 : 300, y: 0 },
	data: {
		node_type: 'stream',
		org_id: organizationId,
		stream_name: streamName,
		stream_type: 'logs',
	},
});

live('pinned OpenObserve v0.92.2 Batch 7 pipelines', () => {
	it('processes a real-time graph and exercises scheduled lifecycle/history with exact cleanup', async () => {
		guard();
		const input = `${prefix}_in`;
		const output = `${prefix}_out`;
		const scheduledOutput = `${prefix}_scheduled_out`;
		const realtimeName = `${prefix}_rt`;
		const scheduledName = `${prefix}_scheduled`;
		let realtimeId = '';
		let scheduledId = '';
		let realtimeDeleted = false;
		let scheduledDeleted = false;
		const realtimeGraph = {
			source: { source_type: 'realtime' },
			nodes: [streamNode('source', 'input', input), streamNode('destination', 'output', output)],
			edges: [{ id: 'esource-destination', source: 'source', target: 'destination' }],
		};
		const queryData = {
			node_type: 'query',
			org_id: organizationId,
			stream_type: 'logs',
			query_condition: { type: 'sql', sql: `select * from "${output}"` },
			trigger_condition: {
				period: 1,
				frequency: 1,
				frequency_type: 'minutes',
				operator: '=',
				threshold: 0,
				silence: 0,
			},
			delay: 0,
		};
		const scheduledGraph = {
			source: {
				source_type: 'scheduled',
				org_id: organizationId,
				stream_type: 'logs',
				query_condition: queryData.query_condition,
				trigger_condition: queryData.trigger_condition,
				delay: 0,
				tz_offset: 0,
			},
			nodes: [
				{ id: 'query', io_type: 'input', position: { x: 0, y: 0 }, data: queryData },
				streamNode('destination', 'output', scheduledOutput),
			],
			edges: [{ id: 'equery-destination', source: 'query', target: 'destination' }],
		};
		try {
			const created = await executePipeline(
				context({
					name: realtimeName,
					pipelineType: 'realtime',
					pipelineJson: JSON.stringify(realtimeGraph),
					enabled: true,
				}),
				'create',
				0,
			);
			realtimeId = String(created[0].json.id ?? created[0].json.pipeline_id ?? '');
			expect(realtimeId).not.toBe('');
			await raw('POST', `/api/${organizationId}/${input}/_json`, [
				{ batch7_tag: suffix, value: 7 },
			]);
			let hits: unknown[] = [];
			for (let attempt = 0; attempt < 20 && !hits.length; attempt++) {
				const now = Date.now() * 1000;
				const searched = (await raw('POST', `/api/${organizationId}/_search`, {
					query: {
						sql: `select * from "${output}" where batch7_tag='${suffix}'`,
						from: 0,
						size: 10,
						start_time: now - 86_400_000_000,
						end_time: now + 3_600_000_000,
					},
				})) as { hits?: unknown[] };
				hits = searched.hits ?? [];
				if (!hits.length) await delay(100);
			}
			expect(hits).toHaveLength(1);
			const got = await executePipeline(context({ pipelineId: realtimeId }), 'get', 0);
			expect(got[0].json.name).toBe(realtimeName);
			const listed = await executePipeline(context({ returnAll: true }), 'getMany', 0);
			expect(listed.some((entry) => entry.json.pipeline_id === realtimeId)).toBe(true);
			await executePipeline(context({ pipelineId: realtimeId }), 'disable', 0);
			await executePipeline(context({ pipelineId: realtimeId }), 'enable', 0);
			const updated = await executePipeline(
				context({
					pipelineId: realtimeId,
					pipelineJson: '{}',
					updateFields: { description: 'updated' },
				}),
				'update',
				0,
			);
			expect(updated).toHaveLength(1);
			const scheduled = await executePipeline(
				context({
					name: scheduledName,
					pipelineType: 'scheduled',
					pipelineJson: JSON.stringify(scheduledGraph),
					enabled: false,
				}),
				'create',
				0,
			);
			scheduledId = String(scheduled[0].json.id ?? scheduled[0].json.pipeline_id ?? '');
			expect(scheduledId).not.toBe('');
			await executePipeline(context({ pipelineId: scheduledId }), 'get', 0);
			await executePipeline(
				context({
					pipelineId: scheduledId,
					pipelineJson: '{}',
					updateFields: { description: 'scheduled-updated' },
				}),
				'update',
				0,
			);
			await executePipeline(context({ pipelineId: scheduledId }), 'enable', 0);
			await executePipeline(context({ pipelineId: scheduledId }), 'disable', 0);
			const history = await executePipeline(
				context({ returnAll: false, limit: 10, historyPipelineId: realtimeId }),
				'getHistory',
				0,
			);
			expect(Array.isArray(history)).toBe(true);
			await executePipeline(
				context({ pipelineId: scheduledId, confirmDestructive: true }),
				'delete',
				0,
			);
			scheduledDeleted = true;
			await executePipeline(
				context({ pipelineId: realtimeId, confirmDestructive: true }),
				'delete',
				0,
			);
			realtimeDeleted = true;
			const remaining = (await raw('GET', `/api/${organizationId}/pipelines`)) as {
				list?: Array<{ pipeline_id?: string }>;
			};
			expect(
				remaining.list?.some((entry) =>
					[realtimeId, scheduledId].includes(entry.pipeline_id ?? ''),
				),
			).toBe(false);
		} finally {
			if (scheduledId && !scheduledDeleted)
				await raw('DELETE', `/api/${organizationId}/pipelines/${scheduledId}`).catch(
					() => undefined,
				);
			if (realtimeId && !realtimeDeleted)
				await raw('DELETE', `/api/${organizationId}/pipelines/${realtimeId}`).catch(
					() => undefined,
				);
			for (const stream of [input, output, scheduledOutput])
				await raw(
					'DELETE',
					`/api/${organizationId}/streams/${stream}?type=logs&delete_all=false`,
				).catch(() => undefined);
			const remaining = (await raw('GET', `/api/${organizationId}/pipelines`)) as {
				list?: Array<{ pipeline_id?: string }>;
			};
			expect(
				remaining.list?.some((entry) =>
					[realtimeId, scheduledId].includes(entry.pipeline_id ?? ''),
				),
			).toBe(false);
		}
	});
});
