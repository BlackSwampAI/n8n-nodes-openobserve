import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { requireJsonObject } from '../../shared/json';
import { normalizeLocatorValue } from '../../shared/locator';
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
) => normalizeLocatorValue(getParameter(context, name, itemIndex, ''), label, itemIndex);
const one = (value: unknown, itemIndex: number): INodeExecutionData[] => [
	{
		json: (value && typeof value === 'object' ? value : { value }) as IDataObject,
		pairedItem: { item: itemIndex },
	},
];
const many = (values: unknown[], itemIndex: number): INodeExecutionData[] =>
	values.map((value) => ({ json: value as IDataObject, pairedItem: { item: itemIndex } }));
const v2 = { apiPathMode: 'v2' as const };
const hasOwn = (value: object, key: string) => Object.prototype.hasOwnProperty.call(value, key);
function validateQueryCondition(
	queryCondition: Record<string, unknown>,
	itemIndex: number,
	options: { requireType: boolean },
): void {
	const type = queryCondition.type;
	if (options.requireType || type !== undefined) {
		if (!['custom', 'sql', 'promql'].includes(String(type ?? '')))
			throw new OpenObserveValidationError(
				`Query JSON type must be custom, sql, or promql at item ${itemIndex}`,
			);
		if (type === 'sql' && !String(queryCondition.sql ?? '').trim())
			throw new OpenObserveValidationError(`Query JSON SQL text is required at item ${itemIndex}`);
		if (type === 'promql' && !String(queryCondition.promql ?? '').trim())
			throw new OpenObserveValidationError(
				`Query JSON PromQL text is required at item ${itemIndex}`,
			);
	}
}
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
	if (destinations.length === 0) {
		throw new OpenObserveValidationError(
			`Select at least one alert destination at item ${itemIndex}`,
		);
	}
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
	validateQueryCondition(queryCondition, itemIndex, { requireType: true });
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

function updateBody(
	context: IExecuteFunctions,
	itemIndex: number,
	current: IDataObject,
): IDataObject {
	const fields = getParameter<Record<string, unknown>>(context, 'updateFields', itemIndex, {});
	if (!fields || typeof fields !== 'object' || Array.isArray(fields))
		throw new OpenObserveValidationError(`Fields to Update must be an object at item ${itemIndex}`);
	const advanced = requireJsonObject(
		hasOwn(fields, 'alertJson')
			? fields.alertJson
			: getParameter(context, 'alertJson', itemIndex, '{}'),
		'Advanced Update JSON',
		itemIndex,
	);
	const friendlyFieldNames = Object.keys(fields).filter((key) => key !== 'alertJson');
	if (Object.keys(advanced).length === 0 && friendlyFieldNames.length === 0)
		throw new OpenObserveValidationError(`Add at least one field to update at item ${itemIndex}`);
	if (advanced.alert_type === 'anomaly_detection' || advanced.alert_type === 'composite')
		throw new OpenObserveValidationError(
			`Only scheduled and real-time alerts are supported at item ${itemIndex}`,
		);
	const currentType = current.alert_type;
	if (hasOwn(advanced, 'alert_type') && advanced.alert_type !== currentType)
		throw new OpenObserveValidationError(
			`Alert type cannot be changed during Update at item ${itemIndex}`,
		);
	if (hasOwn(advanced, 'is_real_time') && advanced.is_real_time !== current.is_real_time)
		throw new OpenObserveValidationError(
			`Alert type cannot be changed during Update at item ${itemIndex}`,
		);
	if (hasOwn(advanced, 'name') && advanced.name !== current.name)
		throw new OpenObserveValidationError(
			`Alert name cannot be changed during Update at item ${itemIndex}`,
		);

	const nested = (key: 'query_condition' | 'trigger_condition'): Record<string, unknown> => {
		const currentValue = current[key];
		const updateValue = advanced[key];
		if (
			updateValue !== undefined &&
			(!updateValue || typeof updateValue !== 'object' || Array.isArray(updateValue))
		)
			throw new OpenObserveValidationError(
				`Advanced Update JSON ${key} must be an object at item ${itemIndex}`,
			);
		return {
			...(currentValue && typeof currentValue === 'object' && !Array.isArray(currentValue)
				? (currentValue as Record<string, unknown>)
				: {}),
			...((updateValue as Record<string, unknown> | undefined) ?? {}),
		};
	};
	const result: IDataObject = {
		...current,
		...advanced,
		...(hasOwn(advanced, 'query_condition') ? { query_condition: nested('query_condition') } : {}),
		...(hasOwn(advanced, 'trigger_condition')
			? { trigger_condition: nested('trigger_condition') }
			: {}),
	};

	if (hasOwn(fields, 'description')) result.description = String(fields.description ?? '');
	if (hasOwn(fields, 'destinations')) {
		const destinations = fields.destinations;
		if (
			!Array.isArray(destinations) ||
			destinations.length === 0 ||
			!destinations.every((value) => typeof value === 'string' && value.trim())
		)
			throw new OpenObserveValidationError(
				`Select at least one destination containing a non-empty name at item ${itemIndex}`,
			);
		result.destinations = destinations.map((value) => value.trim());
	}
	if (hasOwn(fields, 'queryJson')) {
		const queryUpdate = requireJsonObject(fields.queryJson, 'Query JSON', itemIndex);
		validateQueryCondition(queryUpdate, itemIndex, { requireType: false });
		result.query_condition = {
			...(result.query_condition && typeof result.query_condition === 'object'
				? (result.query_condition as Record<string, unknown>)
				: {}),
			...queryUpdate,
		};
	}
	const currentIsRealTime = current.is_real_time === true || current.alert_type === 'realtime';
	const advancedTrigger = advanced.trigger_condition as Record<string, unknown> | undefined;
	if (
		currentIsRealTime &&
		(hasOwn(fields, 'frequency') ||
			hasOwn(fields, 'period') ||
			(advancedTrigger !== undefined &&
				(hasOwn(advancedTrigger, 'frequency') || hasOwn(advancedTrigger, 'period'))))
	)
		throw new OpenObserveValidationError(
			`Check Every and Look Back apply only to scheduled alerts at item ${itemIndex}`,
		);
	const triggerCondition = {
		...(result.trigger_condition && typeof result.trigger_condition === 'object'
			? (result.trigger_condition as Record<string, unknown>)
			: {}),
	};
	if (hasOwn(fields, 'frequency'))
		triggerCondition.frequency = requirePositiveSafeInteger(
			fields.frequency,
			'Frequency',
			itemIndex,
		);
	if (hasOwn(fields, 'period'))
		triggerCondition.period = requirePositiveSafeInteger(fields.period, 'Look Back', itemIndex);
	if (hasOwn(fields, 'threshold'))
		triggerCondition.threshold = requireNonNegativeSafeInteger(
			fields.threshold,
			'Threshold',
			itemIndex,
		);
	if (hasOwn(fields, 'silence'))
		triggerCondition.silence = requireNonNegativeSafeInteger(fields.silence, 'Cooldown', itemIndex);
	if (hasOwn(fields, 'operator')) {
		const operator = String(fields.operator ?? '');
		if (!['=', '!=', '>', '>=', '<', '<='].includes(operator))
			throw new OpenObserveValidationError(`Operator is invalid at item ${itemIndex}`);
		triggerCondition.operator = operator;
	}
	if (
		['frequency', 'period', 'threshold', 'silence', 'operator'].some((key) => hasOwn(fields, key))
	)
		result.trigger_condition = triggerCondition;
	if (hasOwn(advanced, 'query_condition') || hasOwn(fields, 'queryJson'))
		validateQueryCondition(result.query_condition as Record<string, unknown>, itemIndex, {
			requireType: true,
		});

	result.id = current.id;
	result.org_id = current.org_id;
	if (hasOwn(current, 'version')) result.version = current.version;
	if (JSON.stringify(result) === JSON.stringify(current))
		throw new OpenObserveValidationError(
			`The supplied fields do not change the alert at item ${itemIndex}`,
		);
	return result;
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
					...v2,
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
		})) as IDataObject;
		const body = updateBody(context, itemIndex, current);
		return one(
			await openObserveApiRequest.call(context, {
				...v2,
				method: 'PUT',
				pathSegments: path,
				query: { folder },
				body,
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
		const cloneFolder = normalizeLocatorValue(
			getParameter(context, 'cloneFolder', itemIndex, ''),
			'Clone folder',
			itemIndex,
			{ required: false },
		);
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
