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
import { executeDashboard } from '../nodes/OpenObserve/resources/dashboard/execute';
import { executeFunction } from '../nodes/OpenObserve/resources/function/execute';
import { OpenObserveValidationError } from '../nodes/OpenObserve/shared/validation-error';
const fakeNode: INode = {
	id: 'b4',
	name: 'OpenObserve',
	type: '@blackswampai/n8n-nodes-openobserve.openObserve',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};
function context(
	parameters: Record<string, unknown>,
	input: INodeExecutionData[] = [{ json: {} }],
	continueOnFail = false,
): IExecuteFunctions {
	return {
		getNodeParameter: (name: string, _item: number, fallback?: unknown) =>
			parameters[name] ?? fallback,
		getInputData: () => input,
		getNode: () => fakeNode,
		continueOnFail: () => continueOnFail,
	} as unknown as IExecuteFunctions;
}

describe('Batch 4 metadata and selectors', () => {
	beforeEach(() => requestMock.mockReset());
	it('exposes Function and Dashboard without panel operations', () => {
		const node = new OpenObserve();
		const resource = node.description.properties.find((property) => property.name === 'resource');
		expect(resource?.options).toEqual(
			expect.arrayContaining([
				{ name: 'Dashboard', value: 'dashboard' },
				{ name: 'Function', value: 'function' },
			]),
		);
		const dashboard = node.description.properties.find(
			(property) =>
				property.name === 'operation' &&
				property.displayOptions?.show?.resource?.includes('dashboard'),
		);
		expect(dashboard?.options).toHaveLength(5);
		expect(dashboard?.options).not.toContainEqual(
			expect.objectContaining({ value: expect.stringMatching(/panel/i) }),
		);
		expect(node.description.properties.some((property) => property.name === 'transType')).toBe(
			false,
		);
		const folderIndex = node.description.properties.findIndex(
			(property) => property.name === 'folderId',
		);
		const dashboardIndex = node.description.properties.findIndex(
			(property) => property.name === 'dashboardId',
		);
		expect(folderIndex).toBeLessThan(dashboardIndex);
	});
	it('loads searchable functions, dashboards, and current v2 folders', async () => {
		requestMock.mockResolvedValueOnce({ list: [{ name: 'keep' }, { name: 'other' }] });
		const load = {
			getNodeParameter: vi.fn((_name: string, fallback: unknown) => fallback),
		} as unknown as ILoadOptionsFunctions;
		expect(
			(await new OpenObserve().methods.listSearch.searchFunctions.call(load, 'kee')).results,
		).toEqual([{ name: 'keep', value: 'keep' }]);
		requestMock.mockResolvedValueOnce({
			dashboards: [{ dashboard_id: 'id', title: 'Title', folder_name: 'Ops' }],
		});
		expect(
			(await new OpenObserve().methods.listSearch.searchDashboards.call(load, 'Tit')).results,
		).toEqual([{ name: 'Title (Ops)', value: 'id' }]);
		expect(requestMock.mock.calls[1][0]).toMatchObject({
			pathSegments: ['dashboards'],
			query: { folder: 'default', title: 'Tit', pageSize: 100 },
		});
		requestMock.mockResolvedValueOnce({
			list: [
				{ folderId: 'default', name: 'Default' },
				{ folderId: 'f1', name: 'Ops' },
			],
		});
		expect(
			(await new OpenObserve().methods.listSearch.searchDashboardFolders.call(load, 'op')).results,
		).toEqual([{ name: 'Ops', value: 'f1' }]);
		expect(requestMock.mock.calls[2][0]).toMatchObject({
			apiPathMode: 'v2',
			pathSegments: ['folders', 'dashboards'],
		});
		const selectedFolderLoad = {
			getNodeParameter: vi.fn((name: string, fallback: unknown) =>
				name === 'folderId' ? 'folder-two' : fallback,
			),
		} as unknown as ILoadOptionsFunctions;
		requestMock.mockResolvedValueOnce({ dashboards: [] });
		await new OpenObserve().methods.listSearch.searchDashboards.call(selectedFolderLoad);
		expect(requestMock.mock.calls[3][0]).toMatchObject({
			query: { folder: 'folder-two' },
		});
		requestMock.mockResolvedValueOnce({ list: [{ folderId: 'default', name: 'Default' }] });
		expect(
			(await new OpenObserve().methods.listSearch.searchDashboardFolders.call(load)).results,
		).toEqual([{ name: 'Default', value: 'default' }]);
	});
});

describe('Function operations', () => {
	beforeEach(() => requestMock.mockReset());
	it('creates with friendly precedence over advanced JSON', async () => {
		requestMock.mockResolvedValue({ code: 200 });
		await executeFunction(
			context({
				name: 'fn/name',
				vrl: '.x=1\n.',
				params: 'row',
				numArgs: 1,
				advancedJson: '{"name":"wrong","transType":1,"streams":[{"stream":"x"}]}',
			}),
			'create',
			2,
		);
		expect(requestMock.mock.calls[0][0]).toMatchObject({
			method: 'POST',
			pathSegments: ['functions'],
			body: {
				name: 'fn/name',
				function: '.x=1\n.',
				params: 'row',
				numArgs: 1,
				transType: 0,
				streams: [{ stream: 'x' }],
			},
			itemIndex: 2,
		});
	});
	it('lists with Return All or exact Limit and normalizes empty lists', async () => {
		requestMock.mockResolvedValue({ list: [{ name: 'a' }, { name: 'b' }, { name: 'c' }] });
		expect(
			await executeFunction(context({ returnAll: false, limit: 2 }), 'getMany', 0),
		).toHaveLength(2);
		expect(requestMock).toHaveBeenCalledTimes(1);
		requestMock.mockResolvedValue({ list: [] });
		expect(await executeFunction(context({ returnAll: true }), 'getMany', 0)).toEqual([]);
	});
	it('gets dependencies, updates same name, deletes without force, and validates VRL', async () => {
		requestMock.mockResolvedValue({ list: [] });
		await executeFunction(context({ functionName: 'fn/name' }), 'getDependencies', 0);
		expect(requestMock.mock.calls[0][0].pathSegments).toEqual(['functions', 'fn/name']);
		await executeFunction(
			context({
				functionName: 'fn/name',
				vrl: '.x=2\n.',
				params: '',
				numArgs: 0,
				advancedJson: '{}',
			}),
			'update',
			1,
		);
		expect(requestMock.mock.calls[1][0]).toMatchObject({
			method: 'PUT',
			pathSegments: ['functions', 'fn/name'],
			body: { name: 'fn/name', function: '.x=2\n.' },
		});
		await executeFunction(
			context({ functionName: 'fn/name', confirmDestructive: true }),
			'delete',
			2,
		);
		expect(requestMock.mock.calls[2][0]).toMatchObject({
			method: 'DELETE',
			query: { force: false },
		});
		await executeFunction(context({ vrl: '.x=1\n.', eventsJson: '[{"x":0}]' }), 'validate', 3);
		expect(requestMock.mock.calls[3][0]).toMatchObject({
			method: 'POST',
			pathSegments: ['functions', 'test'],
			body: { function: '.x=1\n.', events: [{ x: 0 }], trans_type: 0 },
		});
	});
	it('validates limits, JSON, arguments, and confirmation before transport', async () => {
		await expect(
			executeFunction(context({ returnAll: false, limit: 0 }), 'getMany', 0),
		).rejects.toThrow(/Limit/);
		await expect(
			executeFunction(
				context({ name: 'x', vrl: '.', numArgs: -1, advancedJson: '{}' }),
				'create',
				0,
			),
		).rejects.toThrow(/Argument Count/);
		await expect(
			executeFunction(context({ vrl: '.', eventsJson: '{}' }), 'validate', 0),
		).rejects.toThrow(/JSON array/);
		await expect(
			executeFunction(context({ functionName: 'x', confirmDestructive: false }), 'delete', 0),
		).rejects.toThrow(/Confirm/);
		expect(requestMock).not.toHaveBeenCalled();
	});
});

describe('Dashboard operations', () => {
	beforeEach(() => requestMock.mockReset());
	it('creates with friendly precedence and gets by encoded path segments', async () => {
		requestMock.mockResolvedValue({ version: 8 });
		await executeDashboard(
			context({
				folderId: 'folder/id',
				title: 'Friendly',
				description: 'Desc',
				dashboardJson: '{"title":"wrong","version":8,"tabs":[]}',
			}),
			'create',
			0,
		);
		expect(requestMock.mock.calls[0][0]).toMatchObject({
			method: 'POST',
			pathSegments: ['dashboards'],
			query: { folder: 'folder/id' },
			body: { title: 'Friendly', description: 'Desc', version: 8, tabs: [] },
		});
		await executeDashboard(context({ dashboardId: 'dash/id', folderId: 'folder/id' }), 'get', 1);
		expect(requestMock.mock.calls[1][0]).toMatchObject({
			pathSegments: ['dashboards', 'dash/id'],
			query: { folder: 'folder/id' },
			itemIndex: 1,
		});
	});
	it('lists once with server filter and deterministic client Limit', async () => {
		requestMock.mockResolvedValue({
			dashboards: [{ dashboard_id: '1' }, { dashboard_id: '2' }, { dashboard_id: '3' }],
		});
		expect(
			await executeDashboard(
				context({ folderFilter: 'ops', titleFilter: 'app', returnAll: false, limit: 2 }),
				'getMany',
				0,
			),
		).toHaveLength(2);
		expect(requestMock.mock.calls[0][0]).toMatchObject({
			query: { folder: 'ops', title: 'app', pageSize: 2 },
		});
		requestMock.mockResolvedValue({ dashboards: [] });
		expect(await executeDashboard(context({ returnAll: true }), 'getMany', 0)).toEqual([]);
		expect(requestMock).toHaveBeenCalledTimes(2);
	});
	it('fetches and merges current definition with conflict hash before update', async () => {
		requestMock
			.mockResolvedValueOnce({
				version: 8,
				hash: 'hash-1',
				v8: {
					version: 8,
					dashboardId: 'id',
					title: 'Old',
					description: 'Old',
					tabs: [{ tabId: 'tab' }],
				},
			})
			.mockResolvedValueOnce({ version: 8, hash: 'hash-2' });
		await executeDashboard(
			context({
				dashboardId: 'id',
				folderId: 'default',
				updateFields: {},
				dashboardJson: '{}',
			}),
			'update',
			4,
		);
		expect(requestMock.mock.calls[0][0]).toMatchObject({
			pathSegments: ['dashboards', 'id'],
			query: { folder: 'default' },
		});
		expect(requestMock.mock.calls[1][0]).toMatchObject({
			method: 'PUT',
			query: { folder: 'default', hash: 'hash-1' },
			body: {
				version: 8,
				dashboardId: 'id',
				title: 'Old',
				description: 'Old',
				tabs: [{ tabId: 'tab' }],
			},
			itemIndex: 4,
		});
		requestMock
			.mockResolvedValueOnce({
				version: 8,
				hash: 'hash-2',
				v8: { version: 8, title: 'Old', description: 'Old', tabs: [] },
			})
			.mockResolvedValueOnce({ code: 200 });
		await executeDashboard(
			context({
				dashboardId: 'id',
				folderId: 'default',
				updateFields: {
					dashboardJson: '{"description":"advanced"}',
					title: 'New',
					description: 'Updated',
				},
			}),
			'update',
			4,
		);
		expect(requestMock.mock.calls[3][0].body).toMatchObject({
			title: 'New',
			description: 'Updated',
			tabs: [],
		});
		requestMock
			.mockReset()
			.mockResolvedValueOnce({
				version: 8,
				hash: 'hash-legacy',
				v8: { version: 8, title: 'Old', description: 'Old', tabs: [] },
			})
			.mockResolvedValueOnce({ code: 200 });
		await executeDashboard(
			context({
				dashboardId: 'id',
				folderId: 'default',
				updateFields: { title: 'Legacy' },
				dashboardJson: '{"description":"legacy top-level"}',
			}),
			'update',
			5,
		);
		expect(requestMock.mock.calls[1][0].body).toMatchObject({
			title: 'Legacy',
			description: 'legacy top-level',
		});
	});
	it('requires update concurrency fields and delete confirmation', async () => {
		requestMock.mockResolvedValueOnce({ version: 8, v8: { title: 'x' } });
		await expect(
			executeDashboard(
				context({ dashboardId: 'id', folderId: 'default', title: 'x', dashboardJson: '{}' }),
				'update',
				0,
			),
		).rejects.toThrow(/hash/);
		requestMock.mockReset();
		await expect(
			executeDashboard(
				context({ dashboardId: 'id', folderId: 'default', confirmDestructive: false }),
				'delete',
				0,
			),
		).rejects.toThrow(/Confirm/);
		expect(requestMock).not.toHaveBeenCalled();
	});
	it('deletes the exact dashboard and preserves lineage', async () => {
		requestMock.mockResolvedValue({ code: 200 });
		const result = await executeDashboard(
			context({ dashboardId: 'id/one', folderId: 'default', confirmDestructive: true }),
			'delete',
			5,
		);
		expect(requestMock.mock.calls[0][0]).toMatchObject({
			method: 'DELETE',
			pathSegments: ['dashboards', 'id/one'],
			query: { folder: 'default' },
		});
		expect(result[0].pairedItem).toEqual({ item: 5 });
	});
	it('continues on node-boundary failures with item lineage', async () => {
		requestMock.mockImplementationOnce(async () => {
			throw new OpenObserveValidationError('Dashboard failed safely');
		});
		const execution = context(
			{ resource: 'dashboard', operation: 'get', dashboardId: 'id', folderId: 'default' },
			[{ json: {} }],
			true,
		);
		const [result] = await new OpenObserve().execute.call(execution);
		expect(result[0]).toMatchObject({
			json: { error: expect.stringContaining('Dashboard failed safely') },
			pairedItem: { item: 0 },
		});
	});
});
