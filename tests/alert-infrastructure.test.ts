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
import { executeAlert } from '../nodes/OpenObserve/resources/alert/execute';
import { executeAlertDestination } from '../nodes/OpenObserve/resources/alertDestination/execute';
import { executeAlertTemplate } from '../nodes/OpenObserve/resources/alertTemplate/execute';

const node: INode = {
	id: 'b5',
	name: 'OpenObserve',
	type: 'openObserve',
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
		getNode: () => node,
		continueOnFail: () => continueOnFail,
	} as unknown as IExecuteFunctions;
}

describe('Batch 5 metadata and selectors', () => {
	beforeEach(() => requestMock.mockReset());
	it('registers exactly the three alert infrastructure resources and operations', () => {
		const properties = new OpenObserve().description.properties;
		const resources = properties.find((property) => property.name === 'resource');
		expect(resources?.options).toEqual(
			expect.arrayContaining(
				['alert', 'alertDestination', 'alertTemplate'].map((value) =>
					expect.objectContaining({ value }),
				),
			),
		);
		const operations = (resource: string) =>
			properties.find(
				(property) =>
					property.name === 'operation' &&
					property.displayOptions?.show?.resource?.includes(resource),
			)?.options;
		expect(operations('alertTemplate')).toHaveLength(6);
		expect(operations('alertDestination')).toHaveLength(5);
		expect(operations('alert')).toHaveLength(11);
		const destinations = properties.find(
			(property) => property.name === 'destinations' && property.type === 'multiOptions',
		);
		expect(destinations?.required).toBe(true);
		const updateFields = properties.find(
			(property) =>
				property.name === 'updateFields' &&
				property.displayOptions?.show?.resource?.includes('alert'),
		);
		expect(updateFields).toMatchObject({ type: 'collection', default: {} });
		expect(updateFields?.displayOptions?.show?.operation).toEqual(['update']);
		expect(updateFields?.options?.map((option) => option.name)).toEqual([
			'frequency',
			'silence',
			'description',
			'destinations',
			'period',
			'operator',
			'queryJson',
			'threshold',
		]);
		for (const name of ['frequency', 'period']) {
			const property = properties.find(
				(candidate) =>
					candidate.name === name && candidate.displayOptions?.show?.resource?.includes('alert'),
			);
			expect(property?.displayOptions?.show?.alertType).toEqual(['scheduled']);
		}
	});
	it('loads template, destination, and folder-aware v2 alert selectors', async () => {
		const load = {
			getNodeParameter: vi.fn((name: string, fallback: unknown) =>
				name === 'alertFolder' ? 'ops' : fallback,
			),
		} as unknown as ILoadOptionsFunctions;
		requestMock
			.mockResolvedValueOnce({
				list: [
					{ folderId: 'default', name: 'Duplicate' },
					{ folderId: 'ops', name: 'Operations' },
				],
			})
			.mockResolvedValueOnce([{ name: 'template-a' }])
			.mockResolvedValueOnce([{ name: 'destination-a' }])
			.mockResolvedValueOnce({
				list: [
					{ alert_id: 'alert-id-field', name: 'alert-id-name' },
					{ id: 'id-field', name: 'id-name' },
					{ name: 'missing-id' },
				],
			});
		expect(
			(await new OpenObserve().methods.listSearch.searchAlertFolders.call(load, '')).results,
		).toEqual([
			{ name: 'Default', value: 'default' },
			{ name: 'Operations', value: 'ops' },
		]);
		expect(
			(await new OpenObserve().methods.listSearch.searchAlertTemplates.call(load, 'a')).results,
		).toEqual([{ name: 'template-a', value: 'template-a' }]);
		expect(
			(await new OpenObserve().methods.listSearch.searchAlertDestinations.call(load, 'a')).results,
		).toEqual([{ name: 'destination-a', value: 'destination-a' }]);
		expect(
			(await new OpenObserve().methods.listSearch.searchAlerts.call(load, 'alert')).results,
		).toEqual([
			{ name: 'alert-id-name', value: 'alert-id-field' },
			{ name: 'id-name', value: 'id-field' },
		]);
		expect(requestMock.mock.calls[3][0]).toMatchObject({
			apiPathMode: 'v2',
			query: { folder: 'ops', page_size: 100, page_idx: 0, alert_name_substring: 'alert' },
		});
		requestMock.mockResolvedValueOnce([{ name: 'destination-a' }]);
		expect(await new OpenObserve().methods.loadOptions.getAlertDestinations.call(load)).toEqual([
			{ name: 'destination-a', value: 'destination-a' },
		]);
	});
	it('extracts a folder locator when searching alerts', async () => {
		const load = {
			getNodeParameter: vi.fn(() => ({ mode: 'list', value: 'ops' })),
		} as unknown as ILoadOptionsFunctions;
		requestMock.mockResolvedValueOnce({ list: [] });
		await new OpenObserve().methods.listSearch.searchAlerts.call(load, 'needle');
		expect(requestMock.mock.calls[0][0].query.folder).toBe('ops');
	});
});

describe('Alert Template operations', () => {
	beforeEach(() => requestMock.mockReset());
	it('requires a title only for email template creation', async () => {
		const title = new OpenObserve().description.properties.find(
			(property) =>
				property.name === 'title' &&
				property.displayOptions?.show?.resource?.includes('alertTemplate'),
		);
		expect(title).toMatchObject({ required: true });
		expect(title?.displayOptions?.show?.templateType).toEqual(['email']);
		await expect(
			executeAlertTemplate(
				context({ name: 'mail', templateType: 'email', title: '', body: '{}' }),
				'create',
				4,
			),
		).rejects.toThrow(/Title.*item 4/);
		expect(requestMock).not.toHaveBeenCalled();
	});
	it('constructs create, get, update, delete, list, and prebuilt requests', async () => {
		requestMock.mockResolvedValue({ code: 200 });
		await executeAlertTemplate(
			context({ name: 't', templateType: 'http', title: '', body: '{}', templateJson: '{}' }),
			'create',
			0,
		);
		expect(requestMock.mock.calls[0][0]).toMatchObject({
			method: 'POST',
			pathSegments: ['alerts', 'templates'],
			body: { name: 't', type: 'http', body: '{}', isPrebuilt: false },
		});
		await executeAlertTemplate(context({ templateName: 't' }), 'get', 1);
		expect(requestMock.mock.calls[1][0].pathSegments).toEqual(['alerts', 'templates', 't']);
		requestMock
			.mockResolvedValueOnce({
				name: 't',
				body: 'old',
				isPrebuilt: false,
				isDefault: false,
				kind: 'custom',
			})
			.mockResolvedValueOnce({ code: 200 });
		await executeAlertTemplate(
			context({ templateName: 't', templateJson: '{"body":"new"}' }),
			'update',
			2,
		);
		expect(requestMock.mock.calls[3][0]).toMatchObject({
			method: 'PUT',
			body: { name: 't', body: 'new', isPrebuilt: false, isDefault: false, kind: 'custom' },
		});
		await executeAlertTemplate(
			context({ templateName: 't', confirmDestructive: true }),
			'delete',
			3,
		);
		expect(requestMock.mock.calls[4][0]).toMatchObject({
			method: 'DELETE',
			pathSegments: ['alerts', 'templates', 't'],
		});
		requestMock.mockResolvedValueOnce([{ name: 'a' }, { name: 'b' }]);
		expect(
			await executeAlertTemplate(context({ returnAll: false, limit: 1 }), 'getMany', 0),
		).toHaveLength(1);
		requestMock.mockResolvedValueOnce([]);
		await executeAlertTemplate(context({ returnAll: true }), 'getPrebuilt', 0);
		expect(requestMock.mock.calls[6][0].pathSegments).toEqual([
			'alerts',
			'templates',
			'system',
			'prebuilt',
		]);
	});
	it('preserves template classification and refuses system template updates', async () => {
		requestMock
			.mockResolvedValueOnce({
				name: 't',
				body: 'old',
				isPrebuilt: false,
				isDefault: false,
				kind: 'content',
			})
			.mockResolvedValueOnce({ code: 200 });
		await executeAlertTemplate(
			context({
				templateName: 't',
				templateJson: '{"isPrebuilt":true,"isDefault":true,"kind":"custom"}',
			}),
			'update',
			0,
		);
		expect(requestMock.mock.calls[1][0].body).toMatchObject({
			isPrebuilt: false,
			isDefault: false,
			kind: 'content',
		});
		requestMock.mockReset().mockResolvedValueOnce({ name: 'system', isPrebuilt: true });
		await expect(
			executeAlertTemplate(context({ templateName: 'system', templateJson: '{}' }), 'update', 2),
		).rejects.toThrow(/Prebuilt/);
		expect(requestMock).toHaveBeenCalledTimes(1);
	});
	it('rejects destructive operations before transport', async () => {
		await expect(executeAlertTemplate(context({ templateName: 't' }), 'delete', 0)).rejects.toThrow(
			/Confirm/,
		);
		expect(requestMock).not.toHaveBeenCalled();
	});
});

describe('Alert Destination operations', () => {
	beforeEach(() => requestMock.mockReset());
	it('constructs all requests and redacts response headers', async () => {
		requestMock.mockResolvedValueOnce({ headers: { Authorization: 'secret' }, code: 200 });
		const created = await executeAlertDestination(
			context({
				name: 'd',
				templateName: 't',
				url: 'https://example.test/hook?q=x',
				httpMethod: 'post',
				headersJson: '{"Authorization":"secret"}',
				skipTlsVerify: false,
				destinationJson: '{}',
			}),
			'create',
			0,
		);
		expect(requestMock.mock.calls[0][0]).toMatchObject({
			method: 'POST',
			query: { module: 'alert' },
			body: {
				name: 'd',
				template: 't',
				type: 'http',
				method: 'post',
				headers: { Authorization: 'secret' },
			},
		});
		expect(created[0].json.headers).toEqual({ Authorization: '[REDACTED]' });
		requestMock.mockResolvedValueOnce({ name: 'd', headers: { token: 'secret' } });
		const got = await executeAlertDestination(context({ destinationName: 'd' }), 'get', 0);
		expect(got[0].json.headers).toEqual({ token: '[REDACTED]' });
		requestMock
			.mockResolvedValueOnce({ name: 'd', url: 'https://old.test', headers: {} })
			.mockResolvedValueOnce({ code: 200 });
		await executeAlertDestination(
			context({ destinationName: 'd', destinationJson: '{"url":"https://new.test"}' }),
			'update',
			0,
		);
		expect(requestMock.mock.calls[3][0]).toMatchObject({
			method: 'PUT',
			body: { name: 'd', url: 'https://new.test' },
		});
		await executeAlertDestination(
			context({ destinationName: 'd', confirmDestructive: true }),
			'delete',
			0,
		);
		expect(requestMock.mock.calls[4][0].method).toBe('DELETE');
		requestMock.mockResolvedValueOnce([{ name: 'a', headers: { api_key: 'x' } }, { name: 'b' }]);
		const list = await executeAlertDestination(
			context({ returnAll: false, limit: 1 }),
			'getMany',
			0,
		);
		expect(list).toHaveLength(1);
		expect(list[0].json.headers).toEqual({ api_key: '[REDACTED]' });
	});
	it('rejects unsafe URLs, malformed headers, and unconfirmed deletion', async () => {
		const base = {
			name: 'd',
			templateName: 't',
			httpMethod: 'post',
			skipTlsVerify: false,
			destinationJson: '{}',
		};
		await expect(
			executeAlertDestination(
				context({ ...base, url: 'file:///tmp/x', headersJson: '{}' }),
				'create',
				0,
			),
		).rejects.toThrow(/HTTP or HTTPS/);
		await expect(
			executeAlertDestination(
				context({ ...base, url: 'https://example.test', headersJson: '{"x":1}' }),
				'create',
				0,
			),
		).rejects.toThrow(/string keys and values/);
		await expect(
			executeAlertDestination(context({ destinationName: 'd' }), 'delete', 0),
		).rejects.toThrow(/Confirm/);
		expect(requestMock).not.toHaveBeenCalled();
	});
});

describe('Alert operations', () => {
	beforeEach(() => requestMock.mockReset());
	it('shows folder and target fields exactly where all eleven executors require them', () => {
		const properties = new OpenObserve().description.properties;
		const alertProperty = (name: string) =>
			properties.find(
				(property) =>
					property.name === name && property.displayOptions?.show?.resource?.includes('alert'),
			);
		expect(alertProperty('alertFolder')?.displayOptions?.show?.operation).toEqual([
			'create',
			'getMany',
			'get',
			'update',
			'delete',
			'enable',
			'disable',
			'trigger',
			'clone',
			'export',
		]);
		expect(alertProperty('alertId')?.displayOptions?.show?.operation).toEqual([
			'get',
			'update',
			'delete',
			'enable',
			'disable',
			'trigger',
			'clone',
			'export',
		]);
		expect(alertProperty('historyAlertId')?.displayOptions?.show?.operation).toEqual([
			'getHistory',
		]);
	});
	it('requires a destination before sending the default real-time alert', async () => {
		await expect(
			executeAlert(
				context({
					alertFolder: { mode: 'list', value: 'default' },
					name: 'Testing',
					streamType: 'logs',
					streamName: { mode: 'list', value: 'n8n' },
					alertType: 'realtime',
					queryJson: '{"type":"custom","conditions":null}',
					destinations: [],
					alertJson: '{}',
				}),
				'create',
				3,
			),
		).rejects.toThrow(/Select at least one alert destination at item 3/);
		expect(requestMock).not.toHaveBeenCalled();
	});

	it('sends the default custom condition with list-mode locators and one destination', async () => {
		requestMock.mockResolvedValue({ id: 'a' });
		await executeAlert(
			context({
				alertFolder: { mode: 'list', value: 'default' },
				name: 'Testing',
				streamType: 'logs',
				streamName: { mode: 'list', value: 'n8n' },
				alertType: 'realtime',
				queryJson: '{"type":"custom","conditions":null}',
				destinations: ['webhook'],
				alertJson: '{}',
			}),
			'create',
			0,
		);
		expect(requestMock).toHaveBeenCalledWith(
			expect.objectContaining({
				query: { folder: 'default' },
				body: expect.objectContaining({
					stream_name: 'n8n',
					is_real_time: true,
					query_condition: { type: 'custom', conditions: null },
					destinations: ['webhook'],
				}),
			}),
		);
	});
	it('creates scheduled/real-time alerts through current v2 with friendly fields', async () => {
		requestMock.mockResolvedValue({ id: 'a' });
		await executeAlert(
			context({
				alertFolder: 'default',
				name: 'a',
				streamType: 'logs',
				streamName: 's',
				alertType: 'scheduled',
				queryJson: '{"type":"sql","sql":"select * from s"}',
				threshold: 1,
				operator: '>=',
				frequency: 5,
				period: 10,
				silence: 10,
				destinations: ['d'],
				enabled: false,
				alertJson: '{}',
			}),
			'create',
			2,
		);
		expect(requestMock.mock.calls[0][0]).toMatchObject({
			apiPathMode: 'v2',
			method: 'POST',
			pathSegments: ['alerts'],
			query: { folder: 'default' },
			body: {
				name: 'a',
				stream_type: 'logs',
				is_real_time: false,
				alert_type: 'scheduled',
				destinations: ['d'],
				trigger_condition: { period: 10, frequency: 5, threshold: 1 },
			},
			itemIndex: 2,
		});
	});
	it('gets, fully merges update state, enables, disables, clones, exports, and deletes', async () => {
		requestMock.mockResolvedValue({ id: 'a' });
		const selected = { alertId: 'a', alertFolder: 'default' };
		await executeAlert(context(selected), 'get', 0);
		expect(requestMock.mock.calls[0][0]).toMatchObject({
			apiPathMode: 'v2',
			pathSegments: ['alerts', 'a'],
		});
		requestMock
			.mockResolvedValueOnce({ id: 'a', org_id: 'default', name: 'old', enabled: false })
			.mockResolvedValueOnce({ code: 200 });
		await executeAlert(context({ ...selected, alertJson: '{"description":"new"}' }), 'update', 1);
		expect(requestMock.mock.calls[2][0]).toMatchObject({
			method: 'PUT',
			body: { id: 'a', org_id: 'default', name: 'old', description: 'new' },
		});
		await executeAlert(context(selected), 'enable', 0);
		expect(requestMock.mock.calls[3][0].query).toEqual({ folder: 'default', value: true });
		await executeAlert(context(selected), 'disable', 0);
		expect(requestMock.mock.calls[4][0].query).toEqual({ folder: 'default', value: false });
		await executeAlert(
			context({ ...selected, cloneName: 'clone', cloneFolder: 'ops' }),
			'clone',
			0,
		);
		expect(requestMock.mock.calls[5][0]).toMatchObject({
			method: 'POST',
			body: { name: 'clone', folder_id: 'ops' },
		});
		await executeAlert(context(selected), 'export', 0);
		expect(requestMock.mock.calls[6][0]).toMatchObject({
			method: 'POST',
			pathSegments: ['alerts', 'a', 'export'],
		});
		await executeAlert(context({ ...selected, confirmDestructive: true }), 'delete', 0);
		expect(requestMock.mock.calls[7][0].method).toBe('DELETE');
	});
	it('merges friendly update fields after nested advanced fields and preserves identity', async () => {
		requestMock
			.mockResolvedValueOnce({
				id: 'a',
				org_id: 'default',
				version: 7,
				name: 'old',
				description: 'old description',
				is_real_time: false,
				query_condition: { type: 'sql', sql: 'SELECT old', aggregation: 'count' },
				trigger_condition: {
					period: 10,
					frequency: 5,
					threshold: 1,
					operator: '>=',
					silence: 10,
					frequency_type: 'minutes',
				},
				destinations: ['old-destination'],
			})
			.mockResolvedValueOnce({ code: 200 });
		await executeAlert(
			context({
				alertId: 'a',
				alertFolder: 'default',
				alertJson:
					'{"description":"advanced","query_condition":{"sql":"SELECT advanced"},"trigger_condition":{"threshold":2}}',
				updateFields: {
					description: '',
					destinations: ['new-destination'],
					queryJson: '{"sql":"SELECT friendly"}',
					threshold: 3,
					operator: '<',
					silence: 0,
					frequency: 15,
					period: 20,
				},
			}),
			'update',
			2,
		);
		expect(requestMock.mock.calls[1][0].body).toEqual(
			expect.objectContaining({
				id: 'a',
				org_id: 'default',
				version: 7,
				name: 'old',
				description: '',
				destinations: ['new-destination'],
				query_condition: {
					type: 'sql',
					sql: 'SELECT friendly',
					aggregation: 'count',
				},
				trigger_condition: {
					period: 20,
					frequency: 15,
					threshold: 3,
					operator: '<',
					silence: 0,
					frequency_type: 'minutes',
				},
			}),
		);
	});
	it('rejects empty, unchanged, unsafe, and invalid friendly updates before PUT', async () => {
		const current = {
			id: 'a',
			org_id: 'default',
			name: 'old',
			description: 'old description',
			is_real_time: false,
			query_condition: { type: 'custom', conditions: null },
			trigger_condition: { period: 10, frequency: 5, threshold: 1 },
		};
		for (const parameters of [
			{ alertJson: '{}', updateFields: {} },
			{ alertJson: '{}', updateFields: { description: 'old description' } },
			{ alertJson: '{"name":"renamed"}', updateFields: {} },
			{ alertJson: '{}', updateFields: { destinations: [] } },
			{ alertJson: '{}', updateFields: { destinations: ['valid', ''] } },
			{ alertJson: '{}', updateFields: { queryJson: '{"type":"sql"}' } },
			{ alertJson: '{"is_real_time":true}', updateFields: {} },
			{ alertJson: '{"alert_type":"realtime"}', updateFields: {} },
		]) {
			requestMock.mockReset().mockResolvedValueOnce(current);
			await expect(
				executeAlert(context({ alertId: 'a', alertFolder: 'default', ...parameters }), 'update', 3),
			).rejects.toThrow(/item 3/);
			expect(requestMock).toHaveBeenCalledTimes(1);
		}
	});
	it('rejects scheduled-only update fields for real-time alerts', async () => {
		requestMock.mockResolvedValueOnce({
			id: 'a',
			org_id: 'default',
			name: 'real-time',
			is_real_time: false,
			alert_type: 'realtime',
			trigger_condition: { threshold: 1 },
		});
		await expect(
			executeAlert(
				context({
					alertId: 'a',
					alertFolder: 'default',
					alertJson: '{}',
					updateFields: { frequency: 5 },
				}),
				'update',
				4,
			),
		).rejects.toThrow(/scheduled alerts.*item 4/);
		expect(requestMock).toHaveBeenCalledTimes(1);
	});
	it('propagates a server failure from the full replacement request', async () => {
		const serverError = new Error('OpenObserve rejected the alert update');
		requestMock
			.mockResolvedValueOnce({ id: 'a', org_id: 'default', name: 'old', is_real_time: false })
			.mockRejectedValueOnce(serverError);
		await expect(
			executeAlert(
				context({
					alertId: 'a',
					alertFolder: 'default',
					alertJson: '{}',
					updateFields: { description: 'new' },
				}),
				'update',
				5,
			),
		).rejects.toBe(serverError);
		expect(requestMock).toHaveBeenCalledTimes(2);
	});
	it('manually triggers only after explicit confirmation', async () => {
		await expect(
			executeAlert(context({ alertId: 'a', alertFolder: 'default' }), 'trigger', 0),
		).rejects.toThrow(/Confirm/);
		requestMock.mockResolvedValue({ code: 200 });
		await executeAlert(
			context({ alertId: 'a', alertFolder: 'default', confirmTrigger: true }),
			'trigger',
			0,
		);
		expect(requestMock.mock.calls[0][0]).toMatchObject({
			apiPathMode: 'v2',
			method: 'PATCH',
			pathSegments: ['alerts', 'a', 'trigger'],
		});
	});
	it('paginates alert list and mixed-version history without an extra request', async () => {
		requestMock.mockResolvedValueOnce({ list: [{ id: '1' }, { id: '2' }] });
		const alerts = await executeAlert(
			context({ alertFolder: 'default', returnAll: false, limit: 2 }),
			'getMany',
			0,
		);
		expect(alerts).toHaveLength(2);
		expect(requestMock).toHaveBeenCalledTimes(1);
		requestMock.mockReset().mockResolvedValueOnce({ hits: [{ id: 'h1' }, { id: 'h2' }], total: 2 });
		const history = await executeAlert(
			context({
				returnAll: false,
				limit: 2,
				historyAlertId: 'a',
				startTime: '2026-01-01T00:00:00Z',
				endTime: '2026-01-02T00:00:00Z',
			}),
			'getHistory',
			3,
		);
		expect(history).toHaveLength(2);
		expect(requestMock.mock.calls[0][0]).toMatchObject({
			apiPathMode: 'v2',
			pathSegments: ['alerts', 'history'],
			query: { alert_id: 'a', from: 0, size: 2 },
		});
		expect(history[0].pairedItem).toEqual({ item: 3 });
	});
	it('returns all alert and history pages and terminates on the final short page', async () => {
		requestMock
			.mockResolvedValueOnce({
				list: Array.from({ length: 100 }, (_, index) => ({ id: String(index) })),
			})
			.mockResolvedValueOnce({ list: [{ id: 'last' }] });
		const alerts = await executeAlert(
			context({ alertFolder: { mode: 'list', value: 'default' }, returnAll: true }),
			'getMany',
			0,
		);
		expect(alerts).toHaveLength(101);
		expect(requestMock.mock.calls.map((call) => call[0].query.page_idx)).toEqual([0, 1]);
		requestMock
			.mockReset()
			.mockResolvedValueOnce({
				hits: Array.from({ length: 100 }, (_, index) => ({ id: String(index) })),
				total: 101,
			})
			.mockResolvedValueOnce({ hits: [{ id: 'last' }], total: 101 });
		const history = await executeAlert(context({ returnAll: true }), 'getHistory', 4);
		expect(history).toHaveLength(101);
		expect(requestMock.mock.calls.map((call) => call[0].query.from)).toEqual([0, 100]);
	});
	it('uses current v2 Alert History and normalizes its empty wrapper', async () => {
		requestMock.mockResolvedValueOnce({ total: 0, from: 0, size: 50, hits: [] });
		expect(await executeAlert(context({ returnAll: false, limit: 50 }), 'getHistory', 5)).toEqual(
			[],
		);
		expect(requestMock.mock.calls[0][0]).toMatchObject({
			apiPathMode: 'v2',
			pathSegments: ['alerts', 'history'],
			query: { from: 0, size: 50 },
		});
	});
	it('validates configs and node-boundary continueOnFail preserves lineage', async () => {
		for (const queryJson of ['{}', '{"type":"sql"}', '{"type":"promql"}', '{"type":"unknown"}']) {
			await expect(
				executeAlert(
					context({
						alertFolder: 'default',
						name: 'a',
						streamName: 's',
						queryJson,
						destinations: ['d'],
						alertJson: '{}',
					}),
					'create',
					0,
				),
			).rejects.toThrow(/Query JSON/);
		}
		await expect(
			executeAlert(
				context({
					alertFolder: 'default',
					name: 'a',
					streamName: 's',
					queryJson: '{}',
					destinations: [1],
					alertJson: '{}',
				}),
				'create',
				0,
			),
		).rejects.toThrow(/Destinations/);
		await expect(
			executeAlert(
				context({ alertId: 'a', alertFolder: 'default', confirmDestructive: false }),
				'delete',
				0,
			),
		).rejects.toThrow(/Confirm/);
		requestMock.mockRejectedValueOnce(new Error('safe alert failure'));
		const execution = context(
			{ resource: 'alert', operation: 'get', alertId: 'a', alertFolder: 'default' },
			[{ json: {} }],
			true,
		);
		const [result] = await new OpenObserve().execute.call(execution);
		expect(result[0]).toMatchObject({
			json: { error: 'Unable to connect to OpenObserve' },
			pairedItem: { item: 0 },
		});
	});
});
