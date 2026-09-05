import type { IExecuteFunctions, ILoadOptionsFunctions } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('../nodes/OpenObserve/shared/transport', () => ({ openObserveApiRequest: requestMock }));
import { OpenObserve } from '../nodes/OpenObserve/OpenObserve.node';
import { executePipeline } from '../nodes/OpenObserve/resources/pipeline/execute';

const graph = {
	source: { source_type: 'realtime', org_id: 'default', stream_name: 'in', stream_type: 'logs' },
	nodes: [
		{
			id: 'in',
			io_type: 'input',
			position: { x: 0, y: 0 },
			data: { node_type: 'stream', stream_type: 'logs' },
		},
		{
			id: 'out',
			io_type: 'output',
			position: { x: 1, y: 0 },
			data: { node_type: 'stream', stream_type: 'logs' },
		},
	],
	edges: [{ id: 'ein-out', source: 'in', target: 'out' }],
};
function context(parameters: Record<string, unknown>): IExecuteFunctions {
	return {
		getNodeParameter: (name: string, _index: number, fallback: unknown) =>
			parameters[name] ?? fallback,
	} as unknown as IExecuteFunctions;
}

describe('Pipeline resource', () => {
	beforeEach(() => requestMock.mockReset());
	it('registers exactly eight operations and searches IDs', async () => {
		const node = new OpenObserve();
		const operation = node.description.properties.find(
			(entry) =>
				entry.name === 'operation' && entry.displayOptions?.show?.resource?.includes('pipeline'),
		);
		expect(operation?.options).toHaveLength(8);
		requestMock.mockResolvedValueOnce({
			list: [
				null,
				'bad',
				{ name: 'missing' },
				{ pipeline_id: 'eval', kind: 'evaluation' },
				{ pipeline_id: 'p1', name: 'One' },
			],
		});
		expect(
			await node.methods.listSearch.searchPipelines.call({} as ILoadOptionsFunctions, 'on'),
		).toEqual({ results: [{ name: 'One', value: 'p1' }] });
		expect(requestMock.mock.calls[0][0].pathSegments).toEqual(['pipelines']);
	});
	it('creates real-time and scheduled user pipelines with friendly precedence', async () => {
		requestMock.mockResolvedValue({ pipeline_id: 'p' });
		await executePipeline(
			context({
				name: 'real',
				pipelineType: 'realtime',
				pipelineJson: JSON.stringify({ ...graph, kind: 'evaluation' }),
			}),
			'create',
			0,
		);
		expect(requestMock.mock.calls[0][0]).toMatchObject({
			method: 'POST',
			pathSegments: ['pipelines'],
			body: { name: 'real', kind: 'user', source: { source_type: 'realtime' } },
		});
		const scheduled = {
			...graph,
			nodes: [{ ...graph.nodes[0], data: { node_type: 'query' } }, graph.nodes[1]],
			source: {
				source_type: 'scheduled',
				org_id: 'default',
				stream_type: 'logs',
				query_condition: { type: 'sql', sql: 'select * from "in"' },
				trigger_condition: { frequency: 1, period: 1 },
			},
		};
		await executePipeline(
			context({
				name: 'scheduled',
				pipelineType: 'scheduled',
				pipelineJson: JSON.stringify(scheduled),
			}),
			'create',
			0,
		);
		expect(requestMock.mock.calls[1][0].body.source.source_type).toBe('scheduled');
	});
	it('gets, lists once with Limit/Return All, and rejects malformed lists', async () => {
		requestMock.mockResolvedValueOnce({ pipeline_id: 'p' });
		expect((await executePipeline(context({ pipelineId: 'p' }), 'get', 2))[0].pairedItem).toEqual({
			item: 2,
		});
		requestMock.mockResolvedValueOnce({ list: [{ pipeline_id: '1' }, { pipeline_id: '2' }] });
		expect(
			await executePipeline(context({ returnAll: false, limit: 1 }), 'getMany', 0),
		).toHaveLength(1);
		requestMock.mockResolvedValueOnce({ list: [{ pipeline_id: '1' }, { pipeline_id: '2' }] });
		expect(await executePipeline(context({ returnAll: true }), 'getMany', 0)).toHaveLength(2);
		requestMock.mockResolvedValueOnce({});
		await expect(executePipeline(context({ returnAll: true }), 'getMany', 0)).rejects.toThrow(
			/malformed/,
		);
		requestMock.mockResolvedValueOnce({
			list: [
				null,
				'bad',
				{ name: 'missing-id' },
				{ pipeline_id: 'system', kind: 'evaluation' },
				{ pipeline_id: 'user', kind: 'user' },
			],
		});
		expect(await executePipeline(context({ returnAll: true }), 'getMany', 0)).toHaveLength(1);
	});
	it('updates the collection with full current graph and immutable ID/version', async () => {
		const current = {
			...graph,
			pipeline_id: 'p',
			version: 7,
			name: 'old',
			description: 'keep',
			enabled: true,
		};
		requestMock
			.mockResolvedValueOnce({ list: [{ pipeline_id: 'p' }] })
			.mockResolvedValueOnce(current)
			.mockResolvedValueOnce({ code: 200 });
		await executePipeline(
			context({
				pipelineId: 'p',
				pipelineJson: '{"description":"advanced"}',
				updateFields: { name: 'new' },
			}),
			'update',
			0,
		);
		const update = requestMock.mock.calls[2][0];
		expect(update).toMatchObject({
			method: 'PUT',
			pathSegments: ['pipelines'],
			body: {
				pipeline_id: 'p',
				version: 7,
				name: 'new',
				description: 'advanced',
				edges: graph.edges,
			},
		});
		expect(update.body).not.toHaveProperty('kind');
		expect(update.body.nodes).toEqual(graph.nodes);
	});
	it('enables, disables, and confirms deletion using exact routes', async () => {
		requestMock
			.mockResolvedValueOnce({ list: [{ pipeline_id: 'p' }] })
			.mockResolvedValueOnce({ kind: 'user' })
			.mockResolvedValueOnce({ code: 200 })
			.mockResolvedValueOnce({ list: [{ pipeline_id: 'p' }] })
			.mockResolvedValueOnce({ kind: 'user' })
			.mockResolvedValueOnce({ code: 200 });
		await executePipeline(context({ pipelineId: 'p' }), 'enable', 0);
		await executePipeline(context({ pipelineId: 'p' }), 'disable', 0);
		expect(
			requestMock.mock.calls
				.filter((call) => call[0].method === 'PUT')
				.map((call) => call[0].query),
		).toEqual([{ value: true }, { value: false }]);
		await expect(executePipeline(context({ pipelineId: 'p' }), 'delete', 0)).rejects.toThrow(
			/Confirm/,
		);
		requestMock
			.mockResolvedValueOnce({ list: [{ pipeline_id: 'p' }] })
			.mockResolvedValueOnce({ kind: 'user' })
			.mockResolvedValueOnce({ code: 200 });
		await executePipeline(context({ pipelineId: 'p', confirmDestructive: true }), 'delete', 0);
		expect(requestMock.mock.calls[requestMock.mock.calls.length - 1]?.[0]).toMatchObject({
			method: 'DELETE',
			pathSegments: ['pipelines', 'p'],
		});
		requestMock
			.mockReset()
			.mockResolvedValueOnce({ list: [{ pipeline_id: 'system', kind: 'evaluation' }] });
		await expect(executePipeline(context({ pipelineId: 'system' }), 'enable', 0)).rejects.toThrow(
			/evaluation/,
		);
		expect(requestMock.mock.calls.some((call) => call[0].method === 'PUT')).toBe(false);
	});
	it.each(['update', 'enable', 'disable', 'delete'])(
		'refuses an absent manual pipeline ID before %s mutation',
		async (operation) => {
			requestMock.mockResolvedValueOnce({ list: [{ pipeline_id: 'other' }] });
			await expect(
				executePipeline(
					context({
						pipelineId: 'hidden',
						pipelineJson: '{}',
						updateFields: {},
						confirmDestructive: true,
					}),
					operation,
					0,
				),
			).rejects.toThrow(/user-visible/);
			expect(requestMock).toHaveBeenCalledTimes(1);
			expect(requestMock.mock.calls[0][0]).toMatchObject({ pathSegments: ['pipelines'] });
		},
	);
	it('paginates history in microseconds at the 1000-page boundary without an extra request', async () => {
		requestMock
			.mockResolvedValueOnce({
				total: 1001,
				from: 0,
				size: 1000,
				hits: Array.from({ length: 1000 }, (_, id) => ({ id })),
			})
			.mockResolvedValueOnce({ total: 1001, from: 1000, size: 1, hits: [{ id: 1000 }] });
		const result = await executePipeline(
			context({
				returnAll: true,
				historyPipelineId: { value: 'p' },
				startTime: '2026-01-01T00:00:00Z',
				endTime: '2026-01-02T00:00:00Z',
				sortBy: 'timestamp',
				sortOrder: 'asc',
			}),
			'getHistory',
			0,
		);
		expect(result).toHaveLength(1001);
		expect(requestMock).toHaveBeenCalledTimes(2);
		expect(requestMock.mock.calls[0][0].query).toMatchObject({
			pipeline_id: 'p',
			start_time: 1767225600000000,
			end_time: 1767312000000000,
			from: 0,
			size: 1000,
			sort_by: 'timestamp',
			sort_order: 'asc',
		});
		expect(requestMock.mock.calls[1][0].query).toMatchObject({ from: 1000, size: 1000 });
	});
	it('returns empty history, rejects malformed history, and preserves node-boundary lineage on failure', async () => {
		requestMock.mockResolvedValueOnce({ total: 0, from: 0, size: 50, hits: [] });
		expect(
			await executePipeline(context({ returnAll: false, limit: 50 }), 'getHistory', 3),
		).toEqual([]);
		requestMock.mockResolvedValueOnce({ total: 1 });
		await expect(executePipeline(context({ returnAll: true }), 'getHistory', 0)).rejects.toThrow(
			/malformed/,
		);
		for (const response of [
			{ hits: [], total: -1 },
			{ hits: [], total: Number.MAX_SAFE_INTEGER + 1 },
			{ hits: [] },
		]) {
			requestMock.mockResolvedValueOnce(response);
			await expect(executePipeline(context({ returnAll: true }), 'getHistory', 0)).rejects.toThrow(
				/malformed/,
			);
		}

		requestMock.mockRejectedValueOnce(new Error('connection unavailable'));
		const node = new OpenObserve();
		const executionParameters: Record<string, unknown> = {
			resource: 'pipeline',
			operation: 'get',
			pipelineId: 'p',
		};
		const execution = {
			getInputData: () => [{ json: { input: true } }],
			getNodeParameter: (name: string) => executionParameters[name],
			continueOnFail: () => true,
			getNode: () => ({ name: 'OpenObserve', type: 'openObserve' }),
		} as unknown as IExecuteFunctions;
		const result = await node.execute.call(execution);
		expect(result[0][0].pairedItem).toEqual({ item: 0 });
		expect(result[0][0].json.error).toContain('connect');
	});
	it('validates graph shape, Enterprise remote nodes, edges, dates, and limits', async () => {
		await expect(
			executePipeline(
				context({ name: 'Uppercase', pipelineJson: JSON.stringify(graph) }),
				'create',
				0,
			),
		).rejects.toThrow(/lowercase/);
		for (const pipelineJson of [
			'{}',
			JSON.stringify({ ...graph, source: [] }),
			JSON.stringify({
				...graph,
				nodes: [{ ...graph.nodes[0], position: [0, 0] }, graph.nodes[1]],
			}),
			JSON.stringify({
				...graph,
				nodes: [
					{ ...graph.nodes[0], position: { x: Number.POSITIVE_INFINITY, y: 0 } },
					graph.nodes[1],
				],
			}),
			JSON.stringify({ ...graph, nodes: [graph.nodes[0], graph.nodes[0]] }),
			JSON.stringify({ ...graph, edges: [{ id: 'e', source: 'missing', target: 'out' }] }),
			JSON.stringify({
				...graph,
				nodes: [{ ...graph.nodes[0], data: { node_type: 'remote_stream' } }, graph.nodes[1]],
			}),
		])
			await expect(
				executePipeline(context({ name: 'x', pipelineJson }), 'create', 0),
			).rejects.toThrow();
		await expect(
			executePipeline(context({ returnAll: false, limit: 0 }), 'getMany', 0),
		).rejects.toThrow(/positive/);
		await expect(
			executePipeline(
				context({ returnAll: true, startTime: '2026-02-02', endTime: '2026-01-01' }),
				'getHistory',
				0,
			),
		).rejects.toThrow(/after/);
	});
});
