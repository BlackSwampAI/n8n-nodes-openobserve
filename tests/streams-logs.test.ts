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
import { ingestLogItem, ingestManyLogs } from '../nodes/OpenObserve/resources/log/execute';
import { executeStreamItem, getManyStreams } from '../nodes/OpenObserve/resources/stream/execute';
import { normalizeOpenObserveError } from '../nodes/OpenObserve/shared/errors';

const fakeNode: INode = {
	id: 'batch-2-test',
	name: 'OpenObserve',
	type: '@blackswampai/n8n-nodes-openobserve.openObserve',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

function executeContext(
	parameters: Record<string, unknown>,
	input: INodeExecutionData[] = [{ json: { source: 'input' } }],
	continueOnFail = false,
): IExecuteFunctions {
	return {
		getNodeParameter: (name: string) => parameters[name],
		getInputData: () => input,
		getNode: () => fakeNode,
		continueOnFail: () => continueOnFail,
	} as unknown as IExecuteFunctions;
}

describe('Stream and Log node metadata', () => {
	it('retains the Batch 2 resources and their operations', () => {
		const properties = new OpenObserve().description.properties;
		const resource = properties.find((property) => property.name === 'resource');
		expect(resource?.options).toEqual(
			expect.arrayContaining([
				{ name: 'Log', value: 'log' },
				{ name: 'Stream', value: 'stream' },
			]),
		);
		const operationProperties = properties.filter(
			(property) =>
				property.name === 'operation' &&
				['stream', 'log'].some((resourceName) =>
					property.displayOptions?.show?.resource?.includes(resourceName),
				),
		);
		expect(operationProperties).toHaveLength(2);
		expect(operationProperties[0].displayOptions?.show?.resource).toEqual(['stream']);
		expect(operationProperties[1].displayOptions?.show?.resource).toEqual(['log']);
		expect(operationProperties[0].options).toHaveLength(5);
		expect(operationProperties[1].options).toHaveLength(2);
	});

	it.each([
		['Logs', 'logs'],
		['Metrics', 'metrics'],
		['Traces', 'traces'],
	])('maps %s to %s', (name, value) => {
		const type = new OpenObserve().description.properties.find(
			(property) => property.name === 'streamType',
		);
		expect(type?.options).toContainEqual({ name, value });
	});
});

describe('Stream requests', () => {
	beforeEach(() => requestMock.mockReset());

	it('rejects the deferred Create operation without transport', async () => {
		await expect(
			executeStreamItem(
				executeContext({ streamType: 'logs', streamName: 'not_created' }),
				'create',
				0,
			),
		).rejects.toThrow(/Unsupported Stream operation/);
		expect(requestMock).not.toHaveBeenCalled();
	});

	it('builds schema, settings, delete-fields, and delete requests', async () => {
		requestMock.mockResolvedValue({ code: 200, message: 'ok' });
		await executeStreamItem(
			executeContext({ streamType: 'traces', streamName: 'trace.one', keyword: 'span' }),
			'getSchema',
			0,
		);
		await executeStreamItem(
			executeContext({
				streamType: 'logs',
				streamName: 'logs',
				settingsJson: '{"data_retention":2}',
			}),
			'updateSettings',
			0,
		);
		await executeStreamItem(
			executeContext({
				streamType: 'logs',
				streamName: 'logs',
				fields: 'old, temporary',
				confirmDestructive: true,
			}),
			'deleteFields',
			0,
		);
		await executeStreamItem(
			executeContext({
				streamType: 'logs',
				streamName: 'logs',
				confirmDestructive: true,
				deleteAll: false,
			}),
			'delete',
			0,
		);

		expect(requestMock.mock.calls.map((call) => call[0])).toEqual([
			{
				pathSegments: ['streams', 'trace.one', 'schema'],
				query: { type: 'traces', keyword: 'span' },
				itemIndex: 0,
			},
			{
				method: 'PUT',
				pathSegments: ['streams', 'logs', 'settings'],
				query: { type: 'logs' },
				body: { data_retention: 2 },
				itemIndex: 0,
			},
			{
				method: 'PUT',
				pathSegments: ['streams', 'logs', 'delete_fields'],
				query: { type: 'logs' },
				body: { fields: ['old', 'temporary'] },
				itemIndex: 0,
			},
			{
				method: 'DELETE',
				pathSegments: ['streams', 'logs'],
				query: { type: 'logs', delete_all: false },
				itemIndex: 0,
			},
		]);
	});

	it('paginates Get Many to an exact limit and normalizes list items', async () => {
		requestMock
			.mockResolvedValueOnce({ list: [{ name: 'a' }, { name: 'b' }], total: 4 })
			.mockResolvedValueOnce({ list: [{ name: 'c' }, { name: 'd' }], total: 4 });
		const result = await getManyStreams(
			executeContext({
				returnAll: false,
				limit: 3,
				streamType: 'logs',
				keyword: 'app',
				sort: 'name',
			}),
		);
		expect(result.map((item) => item.json.name)).toEqual(['a', 'b', 'c']);
		expect(requestMock.mock.calls.map((call) => call[0].query)).toEqual([
			{ type: 'logs', offset: 0, limit: 3, keyword: 'app', sort: 'name' },
			{ type: 'logs', offset: 2, limit: 1, keyword: 'app', sort: 'name' },
		]);
	});

	it('Return All follows server pages until total', async () => {
		requestMock
			.mockResolvedValueOnce({ list: [{ name: 'a' }], total: 2 })
			.mockResolvedValueOnce({ list: [{ name: 'b' }], total: 2 });
		const result = await getManyStreams(
			executeContext({ returnAll: true, streamType: 'metrics', keyword: '', sort: '' }),
		);
		expect(result).toHaveLength(2);
		expect(requestMock.mock.calls[1][0].query).toEqual({ type: 'metrics', offset: 1, limit: 100 });
	});

	it.each([
		['delete', { streamType: 'logs', streamName: 'x', confirmDestructive: false }],
		[
			'deleteFields',
			{ streamType: 'logs', streamName: 'x', confirmDestructive: true, fields: ' , ' },
		],
		['updateSettings', { streamType: 'logs', streamName: 'x', settingsJson: '{}' }],
	])('validates %s before transport', async (operation, parameters) => {
		await expect(executeStreamItem(executeContext(parameters), operation, 0)).rejects.toThrow();
		expect(requestMock).not.toHaveBeenCalled();
	});
});

describe('JSON log ingestion', () => {
	beforeEach(() => requestMock.mockReset());

	it('wraps one object in a one-element array without metadata', async () => {
		requestMock.mockResolvedValue({
			code: 200,
			status: [{ name: 'normalized_logs', successful: 1, failed: 0 }],
		});
		const result = await ingestLogItem(
			executeContext({ streamName: 'logs', recordJson: '{"message":"hello","code":42}' }),
			0,
		);
		expect(requestMock.mock.calls[0][0]).toMatchObject({
			method: 'POST',
			pathSegments: ['logs', '_json'],
			body: [{ message: 'hello', code: 42 }],
		});
		expect(result.json).toMatchObject({
			requestedStreamName: 'logs',
			streamName: 'normalized_logs',
			successful: 1,
			failed: 0,
			partialFailure: false,
		});
	});

	it('batches input JSON deterministically and reports partial failures', async () => {
		requestMock.mockResolvedValue({
			code: 200,
			status: [{ name: 'logs', successful: 1, failed: 1 }],
		});
		const input = [{ json: { order: 1 } }, { json: { order: 2 } }];
		const result = await ingestManyLogs(executeContext({ streamName: 'logs' }), input);
		expect(requestMock.mock.calls[0][0].body).toEqual([{ order: 1 }, { order: 2 }]);
		expect(result.json).toMatchObject({
			records: 2,
			successful: 1,
			failed: 1,
			partialFailure: true,
		});
		expect(result.pairedItem).toEqual([{ item: 0 }, { item: 1 }]);
	});

	it.each([
		[{ streamName: '', recordJson: '{}' }, /Stream name/],
		[{ streamName: 'logs', recordJson: '[]' }, /JSON object/],
		[{ streamName: 'logs', recordJson: '{bad' }, /valid JSON/],
	])('rejects invalid single-record input', async (parameters, expected) => {
		await expect(ingestLogItem(executeContext(parameters), 0)).rejects.toThrow(expected);
		expect(requestMock).not.toHaveBeenCalled();
	});

	it('rejects an empty batch', async () => {
		await expect(ingestManyLogs(executeContext({ streamName: 'logs' }), [])).rejects.toThrow(
			/at least one/,
		);
	});
});

describe('node execution and dynamic stream search', () => {
	beforeEach(() => requestMock.mockReset());

	it('returns redacted HTTP errors with item pairing when continue-on-fail is enabled', async () => {
		requestMock.mockImplementationOnce(async () => {
			throw normalizeOpenObserveError(fakeNode, {
				statusCode: 401,
				message: 'authentication failed password=hunter2',
			});
		});
		const node = new OpenObserve();
		const context = executeContext(
			{ resource: 'log', operation: 'ingest', streamName: 'logs', recordJson: '{}' },
			[{ json: {} }],
			true,
		);
		const [result] = await node.execute.call(context);
		expect(result[0].pairedItem).toEqual({ item: 0 });
		expect(String(result[0].json.error)).toContain('OpenObserve authentication failed');
		expect(String(result[0].json.error)).not.toContain('password');
		expect(String(result[0].json.error)).not.toContain('hunter2');
	});

	it('refreshes a filtered stream list through the authenticated transport', async () => {
		requestMock.mockResolvedValue({ list: [{ name: 'application' }], total: 1 });
		const context = { getNodeParameter: () => 'logs' } as unknown as ILoadOptionsFunctions;
		const result = await new OpenObserve().methods.listSearch.searchStreams.call(context, 'app');
		expect(result.results).toEqual([{ name: 'application', value: 'application' }]);
		expect(requestMock.mock.calls[0][0]).toEqual({
			pathSegments: ['streams'],
			query: { type: 'logs', limit: 100, offset: 0, keyword: 'app' },
		});
	});

	it('defaults Log stream search to logs when streamType is absent', async () => {
		requestMock.mockResolvedValue({ list: [], total: 0 });
		const context = {
			getNodeParameter: (name: string, fallback?: unknown) =>
				name === 'resource' ? 'log' : fallback,
		} as unknown as ILoadOptionsFunctions;
		await new OpenObserve().methods.listSearch.searchStreams.call(context);
		expect(requestMock.mock.calls[0][0].query.type).toBe('logs');
	});

	it('pairs an Ingest Many continue-on-fail result to every input item', async () => {
		requestMock.mockImplementationOnce(async () => {
			throw normalizeOpenObserveError(fakeNode, { statusCode: 400, message: 'bad batch' });
		});
		const context = executeContext(
			{ resource: 'log', operation: 'ingestMany', streamName: 'logs' },
			[{ json: { id: 1 } }, { json: { id: 2 } }],
			true,
		);
		const [result] = await new OpenObserve().execute.call(context);
		expect(result[0].pairedItem).toEqual([{ item: 0 }, { item: 1 }]);
		expect(result[0].json.error).toContain('OpenObserve rejected the request');
	});
});
