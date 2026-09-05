import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { requireJsonObject } from '../../shared/json';
import { requireNonNegativeSafeInteger, requirePositiveSafeInteger } from '../../shared/numbers';
import { collectPaginated } from '../../shared/pagination';
import { toOpenObserveMicroseconds } from '../../shared/time';
import { openObserveApiRequest } from '../../shared/transport';
import { OpenObserveValidationError } from '../../shared/validation-error';
const getParameter = <T>(
	context: IExecuteFunctions,
	name: string,
	itemIndex: number,
	fallback: T,
) => context.getNodeParameter(name, itemIndex, fallback) as T;
const getRequiredParameter = (
	context: IExecuteFunctions,
	name: string,
	itemIndex: number,
	label: string,
) => {
	const rawValue = getParameter<unknown>(context, name, itemIndex, '');
	const value = String(
		rawValue && typeof rawValue === 'object' && 'value' in rawValue
			? ((rawValue as { value?: unknown }).value ?? '')
			: rawValue,
	).trim();
	if (!value) throw new OpenObserveValidationError(`${label} is required at item ${itemIndex}`);
	return value;
};
const one = (value: unknown, itemIndex: number): INodeExecutionData[] => [
	{
		json: (value && typeof value === 'object' ? value : { value }) as IDataObject,
		pairedItem: { item: itemIndex },
	},
];
const many = (values: unknown[], itemIndex: number): INodeExecutionData[] =>
	values.map((value) => ({ json: value as IDataObject, pairedItem: { item: itemIndex } }));
const v2 = { apiPathMode: 'v2' as const };
function createBody(context: IExecuteFunctions, itemIndex: number): IDataObject {
	const advanced = requireJsonObject(
		getParameter(context, 'alertJson', itemIndex, '{}'),
		'Alert JSON',
		itemIndex,
	);
	if (advanced.alert_type === 'anomaly_detection' || advanced.alert_type === 'composite')
		throw new OpenObserveValidationError(
			`Only scheduled and real-time alerts are supported at item ${itemIndex}`,
		);
	const destinations = getParameter<unknown[]>(context, 'destinations', itemIndex, []);
	if (!destinations.every((value) => typeof value === 'string' && value.trim()))
		throw new OpenObserveValidationError(
			`Destinations must contain only non-empty names at item ${itemIndex}`,
		);
	const frequency = requirePositiveSafeInteger(
		getParameter(context, 'frequency', itemIndex, 10),
		'Frequency',
		itemIndex,
	);
	const queryCondition = requireJsonObject(
		getParameter(context, 'queryJson', itemIndex, '{}'),
		'Query JSON',
		itemIndex,
	);
	if (!['custom', 'sql', 'promql'].includes(String(queryCondition.type ?? '')))
		throw new OpenObserveValidationError(
			`Query JSON type must be custom, sql, or promql at item ${itemIndex}`,
		);
	if (queryCondition.type === 'sql' && !String(queryCondition.sql ?? '').trim())
		throw new OpenObserveValidationError(`Query JSON SQL text is required at item ${itemIndex}`);
	if (queryCondition.type === 'promql' && !String(queryCondition.promql ?? '').trim())
		throw new OpenObserveValidationError(`Query JSON PromQL text is required at item ${itemIndex}`);
	return {
		...advanced,
		name: getRequiredParameter(context, 'name', itemIndex, 'Name'),
		stream_type: getParameter(context, 'streamType', itemIndex, 'logs'),
		stream_name: getRequiredParameter(context, 'streamName', itemIndex, 'Stream'),
		is_real_time: getParameter<string>(context, 'alertType', itemIndex, 'scheduled') === 'realtime',
		query_condition: queryCondition,
		trigger_condition: {
			period: requirePositiveSafeInteger(
				getParameter(context, 'period', itemIndex, 10),
				'Look Back',
				itemIndex,
			),
			operator: getParameter(context, 'operator', itemIndex, '>='),
			threshold: requireNonNegativeSafeInteger(
				getParameter(context, 'threshold', itemIndex, 1),
				'Threshold',
				itemIndex,
			),
			frequency,
			frequency_type: 'minutes',
			silence: requireNonNegativeSafeInteger(
				getParameter(context, 'silence', itemIndex, 10),
				'Cooldown',
				itemIndex,
			),
		},
		destinations,
		description: getParameter(context, 'description', itemIndex, ''),
		enabled: getParameter(context, 'enabled', itemIndex, false),
		alert_type: getParameter(context, 'alertType', itemIndex, 'scheduled'),
	} as IDataObject;
}
async function listAlerts(context: IExecuteFunctions, itemIndex: number): Promise<unknown[]> {
	const returnAll = getParameter(context, 'returnAll', itemIndex, false);
	const limit = returnAll
		? undefined
		: requirePositiveSafeInteger(getParameter(context, 'limit', itemIndex, 50), 'Limit', itemIndex);
	const folder = getRequiredParameter(context, 'alertFolder', itemIndex, 'Folder');
	const paginationMode = returnAll
		? ({ returnAll: true } as const)
		: ({ returnAll: false, limit: limit! } as const);
	return collectPaginated({
		...paginationMode,
		initialCursor: 0,
		fetchPage: async (pageIndex, remaining) => {
			const size = Math.min(remaining ?? 100, 100);
			const response = (await openObserveApiRequest.call(context, {
				...v2,
				pathSegments: ['alerts'],
				query: { folder, page_size: size, page_idx: pageIndex },
				itemIndex,
			})) as { list?: unknown[] };
			const list = Array.isArray(response.list) ? response.list : [];
			return { items: list, nextCursor: list.length < size ? undefined : pageIndex + 1 };
		},
	});
}
export async function executeAlert(
	context: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'getMany') return many(await listAlerts(context, itemIndex), itemIndex);
	if (operation === 'getHistory') {
		const returnAll = getParameter(context, 'returnAll', itemIndex, false);
		const limit = returnAll
			? undefined
			: requirePositiveSafeInteger(
					getParameter(context, 'limit', itemIndex, 50),
					'Limit',
					itemIndex,
				);
		const start = getParameter(context, 'startTime', itemIndex, '');
		const end = getParameter(context, 'endTime', itemIndex, '');
		const alertId = getParameter(context, 'historyAlertId', itemIndex, '').trim();
		const paginationMode = returnAll
			? ({ returnAll: true } as const)
			: ({ returnAll: false, limit: limit! } as const);
		const rows = await collectPaginated({
			...paginationMode,
			initialCursor: 0,
			fetchPage: async (offset, remaining) => {
				const size = Math.min(remaining ?? 100, 100);
				const response = (await openObserveApiRequest.call(context, {
					pathSegments: ['alerts', 'history'],
					query: {
						...(alertId ? { alert_id: alertId } : {}),
						...(start ? { start_time: toOpenObserveMicroseconds(start, { itemIndex }) } : {}),
						...(end ? { end_time: toOpenObserveMicroseconds(end, { itemIndex }) } : {}),
						from: offset,
						size,
					},
					itemIndex,
				})) as { hits?: unknown[]; total?: number };
				const hits = Array.isArray(response.hits) ? response.hits : [];
				return {
					items: hits,
					nextCursor:
						hits.length === 0 || offset + hits.length >= (response.total ?? 0)
							? undefined
							: offset + hits.length,
				};
			},
		});
		return many(rows, itemIndex);
	}
	if (operation === 'create')
		return one(
			await openObserveApiRequest.call(context, {
				...v2,
				method: 'POST',
				pathSegments: ['alerts'],
				query: { folder: getRequiredParameter(context, 'alertFolder', itemIndex, 'Folder') },
				body: createBody(context, itemIndex),
				itemIndex,
			}),
			itemIndex,
		);
	const id = getRequiredParameter(context, 'alertId', itemIndex, 'Alert ID');
	const folder = getRequiredParameter(context, 'alertFolder', itemIndex, 'Folder');
	const path = ['alerts', id];
	if (operation === 'get' || operation === 'export')
		return one(
			await openObserveApiRequest.call(context, {
				...v2,
				method: operation === 'export' ? 'POST' : 'GET',
				pathSegments: operation === 'export' ? [...path, 'export'] : path,
				query: { folder },
				itemIndex,
			}),
			itemIndex,
		);
	if (operation === 'update') {
		const current = (await openObserveApiRequest.call(context, {
			...v2,
			pathSegments: path,
			query: { folder },
			itemIndex,
		})) as Record<string, unknown>;
		const update = requireJsonObject(
			getParameter(context, 'alertJson', itemIndex, '{}'),
			'Update JSON',
			itemIndex,
		);
		if (update.alert_type === 'anomaly_detection' || update.alert_type === 'composite')
			throw new OpenObserveValidationError(
				`Only scheduled and real-time alerts are supported at item ${itemIndex}`,
			);
		return one(
			await openObserveApiRequest.call(context, {
				...v2,
				method: 'PUT',
				pathSegments: path,
				query: { folder },
				body: { ...current, ...update, id: current.id, org_id: current.org_id },
				itemIndex,
			}),
			itemIndex,
		);
	}
	if (operation === 'enable' || operation === 'disable')
		return one(
			await openObserveApiRequest.call(context, {
				...v2,
				method: 'PATCH',
				pathSegments: [...path, 'enable'],
				query: { folder, value: operation === 'enable' },
				itemIndex,
			}),
			itemIndex,
		);
	if (operation === 'clone') {
		const cloneName = getParameter(context, 'cloneName', itemIndex, '').trim();
		const rawCloneFolder = getParameter<unknown>(context, 'cloneFolder', itemIndex, '');
		const cloneFolder = String(
			rawCloneFolder && typeof rawCloneFolder === 'object' && 'value' in rawCloneFolder
				? ((rawCloneFolder as { value?: unknown }).value ?? '')
				: rawCloneFolder,
		).trim();
		return one(
			await openObserveApiRequest.call(context, {
				...v2,
				method: 'POST',
				pathSegments: [...path, 'clone'],
				query: { folder },
				body: {
					...(cloneName ? { name: cloneName } : {}),
					...(cloneFolder ? { folder_id: cloneFolder } : {}),
				},
				itemIndex,
			}),
			itemIndex,
		);
	}
	if (operation === 'trigger') {
		if (!getParameter(context, 'confirmTrigger', itemIndex, false))
			throw new OpenObserveValidationError(`Confirm manual alert trigger at item ${itemIndex}`);
		return one(
			await openObserveApiRequest.call(context, {
				...v2,
				method: 'PATCH',
				pathSegments: [...path, 'trigger'],
				query: { folder },
				itemIndex,
			}),
			itemIndex,
		);
	}
	if (operation !== 'delete')
		throw new OpenObserveValidationError(
			`Unsupported Alert operation "${operation}" at item ${itemIndex}`,
		);
	if (!getParameter(context, 'confirmDestructive', itemIndex, false))
		throw new OpenObserveValidationError(`Confirm alert deletion at item ${itemIndex}`);
	return one(
		await openObserveApiRequest.call(context, {
			...v2,
			method: 'DELETE',
			pathSegments: path,
			query: { folder },
			itemIndex,
		}),
		itemIndex,
	);
}
