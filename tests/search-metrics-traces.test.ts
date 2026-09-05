import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INode,
	INodeExecutionData,
} from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('../nodes/OpenObserve/shared/transport', () => ({ openObserveApiRequest: requestMock }));

import { OpenObserve } from '../nodes/OpenObserve/OpenObserve.node';
import {
	executeMetric,
	ingestManyMetrics,
	ingestMetric,
} from '../nodes/OpenObserve/resources/metric/execute';
import { executeSearch } from '../nodes/OpenObserve/resources/search/execute';
import { executeTrace } from '../nodes/OpenObserve/resources/trace/execute';
import { OpenObserveValidationError } from '../nodes/OpenObserve/shared/validation-error';

const start = '2026-09-05T00:00:00.000Z';
const end = '2026-09-05T01:00:00.000Z';
const fakeNode: INode = {
	id: 'b3',
	name: 'OpenObserve',
	type: '@blackswampai/n8n-nodes-openobserve.openObserve',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};
function context(
	parameters: Record<string, unknown>,
	input: INodeExecutionData[] = [],
): IExecuteFunctions {
	return {
		getNodeParameter: (name: string, _item: number, fallback?: unknown) =>
			parameters[name] ?? fallback,
		getInputData: () => input,
	} as unknown as IExecuteFunctions;
}

describe('Batch 3 metadata', () => {
	it('retains all Batch 3 resources and defers service graph', () => {
		const node = new OpenObserve();
		const resource = node.description.properties.find((p) => p.name === 'resource');
		expect(resource?.options).toEqual(
			expect.arrayContaining(
				['log', 'metric', 'search', 'stream', 'trace'].map((value) =>
					expect.objectContaining({ value }),
				),
			),
		);
		const trace = node.description.properties.find(
			(p) => p.name === 'operation' && p.displayOptions?.show?.resource?.includes('trace'),
		);
		expect(trace?.options).toHaveLength(2);
		expect(trace?.options).not.toContainEqual(
			expect.objectContaining({ value: 'getServiceGraph' }),
		);
	});
	it.each([
		['metric', 'metrics'],
		['trace', 'traces'],
	])('filters %s stream selection as %s', async (resource, type) => {
		requestMock.mockResolvedValue({ list: [], total: 0 });
		const c = {
			getNodeParameter: (name: string, fallback?: unknown) =>
				name === 'resource' ? resource : fallback,
		} as unknown as ILoadOptionsFunctions;
		await new OpenObserve().methods.listSearch.searchStreams.call(c);
		expect(requestMock.mock.calls[requestMock.mock.calls.length - 1]?.[0].query.type).toBe(type);
	});
	it('forces log streams for Search Around but retains Field Values type', async () => {
		requestMock.mockResolvedValue({ list: [], total: 0 });
		const search = async (operation: string) => {
			const searchContext = {
				getNodeParameter: (name: string, fallback?: unknown) =>
					(({ resource: 'search', operation, streamType: 'metrics' }) as Record<string, unknown>)[
						name
					] ?? fallback,
			} as unknown as ILoadOptionsFunctions;
			await new OpenObserve().methods.listSearch.searchStreams.call(searchContext);
			return requestMock.mock.calls[requestMock.mock.calls.length - 1]?.[0].query.type;
		};
		expect(await search('searchAround')).toBe('logs');
		expect(await search('getFieldValues')).toBe('metrics');
	});
});

describe('Search', () => {
	beforeEach(() => requestMock.mockReset());
	it('builds SQL query with microseconds and returns rows or raw metadata', async () => {
		requestMock.mockResolvedValue({ hits: [{ message: 'one' }], total: 1, took: 2 });
		const params = {
			sql: 'select * from logs',
			startTime: start,
			endTime: end,
			offset: 2,
			limit: 5,
			streamType: 'logs',
			searchType: 'ui',
			timeout: 10,
			outputMode: 'rows',
		};
		const rows = await executeSearch(context(params), 'query', 0);
		expect(rows[0].json.message).toBe('one');
		expect(requestMock.mock.calls[0][0]).toMatchObject({
			method: 'POST',
			pathSegments: ['_search'],
			query: { type: 'logs' },
			body: {
				query: {
					sql: 'select * from logs',
					start_time: 1788566400000000,
					end_time: 1788570000000000,
					from: 2,
					size: 5,
				},
				search_type: 'ui',
				timeout: 10,
			},
		});
		const raw = await executeSearch(context({ ...params, outputMode: 'raw' }), 'query', 0);
		expect(raw[0].json).toMatchObject({ total: 1, took: 2 });
		await executeSearch(context({ ...params, outputMode: 'csv', returnAll: true }), 'query', 0);
		expect(requestMock.mock.calls[2][0].body.agent_options).toEqual({ output_format: 'csv' });
		expect(requestMock.mock.calls[2][0].body.query.size).toBe(5);
	});
	it('builds field-values GET and around POST', async () => {
		requestMock.mockResolvedValue({ values: [] });
		await executeSearch(
			context({
				streamName: 'a/b',
				fields: 'service,status',
				startTime: start,
				endTime: end,
				offset: 0,
				limit: 20,
				streamType: 'traces',
				filter: 'x=y',
				keyword: 'api',
				timeout: 5,
			}),
			'getFieldValues',
			1,
		);
		expect(requestMock.mock.calls[0][0]).toMatchObject({
			pathSegments: ['a/b', '_values'],
			query: {
				type: 'traces',
				fields: 'service,status',
				from: 0,
				size: 20,
				filter: 'x=y',
				keyword: 'api',
				timeout: 5,
			},
			itemIndex: 1,
		});
		await executeSearch(
			context({ streamName: 'logs', aroundRecordJson: '{"_timestamp":1}', limit: 10, timeout: 3 }),
			'searchAround',
			0,
		);
		expect(requestMock.mock.calls[1][0]).toMatchObject({
			method: 'POST',
			pathSegments: ['logs', '_around'],
			query: { size: 10, timeout: 3 },
			body: { _timestamp: 1 },
		});
	});
	it('rejects invalid range, body, and limit', async () => {
		await expect(
			executeSearch(context({ sql: 'x', startTime: end, endTime: start, limit: 1 }), 'query', 0),
		).rejects.toThrow(/Start time/);
		await expect(
			executeSearch(
				context({ streamName: 'x', aroundRecordJson: '[]', limit: 1 }),
				'searchAround',
				0,
			),
		).rejects.toThrow(/JSON object/);
		await expect(executeSearch(context({ limit: 0 }), 'query', 0)).rejects.toThrow(/Limit/);
		await expect(
			executeSearch(context({ limit: 1, timeout: -1 }), 'searchAround', 0),
		).rejects.toThrow(/Timeout/);
		await expect(
			executeSearch(
				context({ sql: 'x', startTime: start, endTime: end, limit: 1, offset: 1.5 }),
				'query',
				0,
			),
		).rejects.toThrow(/Offset/);
	});
	it('paginates Return All without an extra request', async () => {
		requestMock
			.mockResolvedValueOnce({ hits: [{ id: 1 }], total: 2 })
			.mockResolvedValueOnce({ hits: [{ id: 2 }], total: 2 });
		const result = await executeSearch(
			context({
				sql: 'select * from x',
				startTime: start,
				endTime: end,
				offset: 0,
				limit: 1,
				returnAll: true,
				streamType: 'logs',
			}),
			'query',
			0,
		);
		expect(result.map((v) => v.json.id)).toEqual([1, 2]);
		expect(result.every((item) => JSON.stringify(item.pairedItem) === '{"item":0}')).toBe(true);
		expect(requestMock).toHaveBeenCalledTimes(2);
	});
});

describe('Metrics', () => {
	beforeEach(() => requestMock.mockReset());
	it('ingests one and many records with lineage and partial counts', async () => {
		requestMock.mockResolvedValue({ status: [{ name: 'metric', successful: 1, failed: 1 }] });
		const one = await ingestMetric(context({ metricJson: '{"__name__":"metric","value":1}' }), 0);
		expect(one.pairedItem).toEqual({ item: 0 });
		expect(requestMock.mock.calls[0][0].body).toEqual([{ __name__: 'metric', value: 1 }]);
		const input = [
			{ json: { __name__: 'metric', value: 1 } },
			{ json: { __name__: 'metric', value: 2 } },
		];
		const many = await ingestManyMetrics(context({}, input), input);
		expect(many.pairedItem).toEqual([{ item: 0 }, { item: 1 }]);
		expect(many.json.partialFailure).toBe(true);
	});
	it('pairs a node-boundary Ingest Many continue-on-fail error to every input', async () => {
		requestMock.mockImplementationOnce(async () => {
			throw new OpenObserveValidationError('Metric batch rejected safely');
		});
		const input = [{ json: { value: 1 } }, { json: { value: 2 } }];
		const executionContext = {
			getNodeParameter: (name: string) =>
				(({ resource: 'metric', operation: 'ingestMany' }) as Record<string, unknown>)[name],
			getInputData: () => input,
			getNode: () => fakeNode,
			continueOnFail: () => true,
		} as unknown as IExecuteFunctions;
		const [output] = await new OpenObserve().execute.call(executionContext);
		expect(output[0].pairedItem).toEqual([{ item: 0 }, { item: 1 }]);
		expect(output[0].json.error).toContain('Metric batch rejected safely');
	});
	it.each([
		[
			'instantQuery',
			{ promql: 'up', queryTime: start, queryTimeout: '5s' },
			['prometheus', 'api', 'v1', 'query'],
			{ query: 'up', time: start, timeout: '5s' },
		],
		[
			'rangeQuery',
			{ promql: 'rate(x[5m])', startTime: start, endTime: end, step: '60s' },
			['prometheus', 'api', 'v1', 'query_range'],
			{ query: 'rate(x[5m])', start, end, step: '60s' },
		],
		[
			'getMetadata',
			{ metricName: 'x', limit: 4 },
			['prometheus', 'api', 'v1', 'metadata'],
			{ limit: 4, metric: 'x' },
		],
		[
			'getLabels',
			{ selectors: '{__name__="x"}\n{job="a",instance="b"}', startTime: start, endTime: end },
			['prometheus', 'api', 'v1', 'labels'],
			{ 'match[]': ['{__name__="x"}', '{job="a",instance="b"}'], start, end },
		],
		[
			'getLabelValues',
			{ labelName: 'job/name', selectors: '{__name__="x"}', startTime: start, endTime: end },
			['prometheus', 'api', 'v1', 'label', 'job/name', 'values'],
			{ 'match[]': ['{__name__="x"}'], start, end },
		],
		[
			'findSeries',
			{ selectors: '{__name__="x"}', startTime: start, endTime: end },
			['prometheus', 'api', 'v1', 'series'],
			{ 'match[]': ['{__name__="x"}'], start, end },
		],
	] as const)('builds %s request', async (operation, parameters, path, query) => {
		requestMock.mockResolvedValue({ status: 'success', data: [] });
		await executeMetric(context(parameters), operation, 0);
		expect(requestMock.mock.calls[0][0]).toMatchObject({ pathSegments: path, query });
	});
	it('normalizes vector, matrix, scalar, empty, and raw envelopes', async () => {
		for (const resultType of ['vector', 'matrix']) {
			requestMock.mockResolvedValueOnce({
				status: 'success',
				data: { resultType, result: [{ metric: { job: 'a' }, value: [1, '2'] }] },
			});
			const out = await executeMetric(context({ promql: 'x' }), 'instantQuery', 0);
			expect(out[0].json).toMatchObject({ resultType, metric: { job: 'a' } });
		}
		requestMock.mockResolvedValueOnce({
			status: 'success',
			data: { resultType: 'scalar', result: [1, '2'] },
		});
		expect(
			(await executeMetric(context({ promql: 'x' }), 'instantQuery', 0))[0].json,
		).toMatchObject({ resultType: 'scalar', value: [1, '2'] });
		requestMock.mockResolvedValueOnce({ status: 'success', data: [] });
		expect(await executeMetric(context({ promql: 'x' }), 'instantQuery', 0)).toEqual([]);
		requestMock.mockResolvedValueOnce({ status: 'error', error: 'bad' });
		await expect(executeMetric(context({ promql: 'x' }), 'instantQuery', 2)).rejects.toThrow(
			/Prometheus query failed at item 2: bad/,
		);
		requestMock.mockResolvedValueOnce({ status: 'error', error: 'bad' });
		expect(
			(await executeMetric(context({ promql: 'x', rawResponse: true }), 'instantQuery', 0))[0].json,
		).toMatchObject({ status: 'error', error: 'bad' });
	});
	it('rejects invalid time, range, step, limit, and empty ingestion', async () => {
		await expect(
			executeMetric(
				context({ promql: 'x', startTime: 'bad', endTime: end, step: '1s' }),
				'rangeQuery',
				0,
			),
		).rejects.toThrow(/Start/);
		await expect(
			executeMetric(
				context({ promql: 'x', startTime: start, endTime: end, step: 'zero' }),
				'rangeQuery',
				0,
			),
		).rejects.toThrow(/Step/);
		await expect(
			executeMetric(
				context({ promql: 'x', startTime: start, endTime: end, step: '1.5h' }),
				'rangeQuery',
				0,
			),
		).rejects.toThrow(/Step/);
		await expect(
			executeMetric(
				context({ promql: 'x', startTime: start, endTime: end, step: '0s' }),
				'rangeQuery',
				0,
			),
		).rejects.toThrow(/Step/);
		await expect(
			executeMetric(
				context({ promql: 'x', startTime: end, endTime: start, step: '1s' }),
				'rangeQuery',
				0,
			),
		).rejects.toThrow(/Start time/);
		await expect(executeMetric(context({ limit: 0 }), 'getMetadata', 0)).rejects.toThrow(/Limit/);
		await expect(ingestManyMetrics(context({}), [])).rejects.toThrow(/at least one/);
	});
	it.each(['1h30m', '54s321ms'])('accepts composite Prometheus step %s', async (step) => {
		requestMock.mockResolvedValue({ status: 'success', data: [] });
		await executeMetric(
			context({ promql: 'x', startTime: start, endTime: end, step }),
			'rangeQuery',
			0,
		);
		expect(requestMock.mock.calls[0][0].query.step).toBe(step);
	});
	it.each(['30m1h', '1h1h', '1s2m', '1.5s', '1x'])(
		'rejects malformed Prometheus step %s',
		async (step) => {
			await expect(
				executeMetric(
					context({ promql: 'x', startTime: start, endTime: end, step }),
					'rangeQuery',
					0,
				),
			).rejects.toThrow(/Step/);
		},
	);
});

describe('Trace reads', () => {
	beforeEach(() => requestMock.mockReset());
	it('builds latest and DAG requests and normalizes empty hits', async () => {
		requestMock.mockResolvedValue({ hits: [] });
		expect(
			await executeTrace(
				context({
					streamName: 'traces',
					startTime: start,
					endTime: end,
					offset: 2,
					limit: 5,
					filter: 'service_name=x',
					sortBy: 'duration',
					sortOrder: 'asc',
					timeout: 3,
				}),
				'getLatest',
				0,
			),
		).toEqual([]);
		expect(requestMock.mock.calls[0][0]).toMatchObject({
			pathSegments: ['traces', 'traces', 'latest'],
			query: {
				from: 2,
				size: 5,
				filter: 'service_name=x',
				sort_by: 'duration',
				sort_order: 'asc',
				timeout: 3,
			},
		});
		requestMock.mockResolvedValue({ nodes: [] });
		await executeTrace(
			context({ streamName: 'traces', traceId: 'a/b', startTime: start, endTime: end }),
			'getDag',
			1,
		);
		expect(requestMock.mock.calls[1][0]).toMatchObject({
			pathSegments: ['traces', 'traces', 'a/b', 'dag'],
			itemIndex: 1,
		});
	});
	it('paginates Get Latest for Return All and an exact multi-page Limit with lineage', async () => {
		requestMock
			.mockResolvedValueOnce({ hits: [{ id: 1 }, { id: 2 }], total: 3 })
			.mockResolvedValueOnce({ hits: [{ id: 3 }], total: 3 });
		const all = await executeTrace(
			context({ streamName: 'traces', startTime: start, endTime: end, offset: 0, returnAll: true }),
			'getLatest',
			4,
		);
		expect(all.map((item) => item.json.id)).toEqual([1, 2, 3]);
		expect(all.every((item) => JSON.stringify(item.pairedItem) === '{"item":4}')).toBe(true);
		expect(requestMock.mock.calls.map((call) => call[0].query.from)).toEqual([0, 2]);
		requestMock.mockReset();
		requestMock
			.mockResolvedValueOnce({ hits: [{ id: 1 }, { id: 2 }], total: 9 })
			.mockResolvedValueOnce({ hits: [{ id: 3 }], total: 9 });
		const limited = await executeTrace(
			context({
				streamName: 'traces',
				startTime: start,
				endTime: end,
				offset: 5,
				returnAll: false,
				limit: 3,
			}),
			'getLatest',
			0,
		);
		expect(limited).toHaveLength(3);
		expect(requestMock.mock.calls.map((call) => call[0].query)).toMatchObject([
			{ from: 5, size: 3 },
			{ from: 7, size: 1 },
		]);
	});
	it.each([
		[{ offset: -1, limit: 1, timeout: 0 }, /Offset/],
		[{ offset: 0, limit: 0, timeout: 0 }, /Limit/],
		[{ offset: 0, limit: 1, timeout: -1 }, /Timeout/],
		[{ offset: Number.MAX_SAFE_INTEGER + 1, limit: 1, timeout: 0 }, /Offset/],
	])('rejects expression-supplied invalid latest pagination values', async (invalid, expected) => {
		await expect(
			executeTrace(
				context({
					streamName: 'traces',
					startTime: start,
					endTime: end,
					returnAll: false,
					...invalid,
				}),
				'getLatest',
				0,
			),
		).rejects.toThrow(expected);
	});
	it('validates DAG timeout at execution time', async () => {
		await expect(
			executeTrace(
				context({
					streamName: 'traces',
					traceId: 'id',
					startTime: start,
					endTime: end,
					timeout: 1.5,
				}),
				'getDag',
				0,
			),
		).rejects.toThrow(/Timeout/);
	});
});
