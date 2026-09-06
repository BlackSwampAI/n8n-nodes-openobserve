import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { requireJsonObject } from '../../shared/json';
import { normalizeLocatorValue } from '../../shared/locator';
import { requirePositiveSafeInteger } from '../../shared/numbers';
import { openObserveApiRequest } from '../../shared/transport';
import { OpenObserveValidationError } from '../../shared/validation-error';
interface DashboardEnvelope extends IDataObject {
	version?: number;
	hash?: string;
}
const getParameter = <T>(
	context: IExecuteFunctions,
	name: string,
	itemIndex: number,
	defaultValue: T,
) => context.getNodeParameter(name, itemIndex, defaultValue) as T;
const getRequiredParameter = (
	context: IExecuteFunctions,
	name: string,
	itemIndex: number,
	label: string,
) => normalizeLocatorValue(context.getNodeParameter(name, itemIndex, ''), label, itemIndex);
const toItem = (value: unknown, itemIndex: number): INodeExecutionData => ({
	json: (value && typeof value === 'object' ? value : { value }) as IDataObject,
	pairedItem: { item: itemIndex },
});
function createBody(context: IExecuteFunctions, itemIndex: number): IDataObject {
	const advanced = requireJsonObject(
		context.getNodeParameter('dashboardJson', itemIndex, '{}'),
		'Advanced Update JSON',
		itemIndex,
	) as IDataObject;
	return {
		...advanced,
		title: getRequiredParameter(context, 'title', itemIndex, 'Title'),
		description: getParameter(context, 'description', itemIndex, ''),
	};
}
function updateBody(
	context: IExecuteFunctions,
	itemIndex: number,
	current: IDataObject,
): IDataObject {
	const fields = getParameter<IDataObject>(context, 'updateFields', itemIndex, {});
	const advanced = requireJsonObject(
		Object.prototype.hasOwnProperty.call(fields, 'dashboardJson')
			? fields.dashboardJson
			: context.getNodeParameter('dashboardJson', itemIndex, '{}'),
		'Dashboard JSON',
		itemIndex,
	) as IDataObject;
	const result: IDataObject = {
		...current,
		...advanced,
	};
	if (Object.prototype.hasOwnProperty.call(fields, 'title')) {
		const title = String(fields.title ?? '').trim();
		if (!title) throw new OpenObserveValidationError(`Title is required at item ${itemIndex}`);
		result.title = title;
	}
	if (Object.prototype.hasOwnProperty.call(fields, 'description'))
		result.description = String(fields.description ?? '');
	return result;
}
export async function executeDashboard(
	context: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'getMany') {
		const folder = getParameter(context, 'folderFilter', itemIndex, '').trim();
		const title = getParameter(context, 'titleFilter', itemIndex, '').trim();
		const returnAll = getParameter(context, 'returnAll', itemIndex, false);
		const limit = returnAll
			? undefined
			: requirePositiveSafeInteger(
					getParameter(context, 'limit', itemIndex, 50),
					'Limit',
					itemIndex,
				);
		const response = (await openObserveApiRequest.call(context, {
			pathSegments: ['dashboards'],
			query: {
				...(folder ? { folder } : {}),
				...(title ? { title } : {}),
				...(!returnAll && title ? { pageSize: limit } : {}),
			},
			itemIndex,
		})) as { dashboards?: unknown[] };
		const dashboards = Array.isArray(response.dashboards) ? response.dashboards : [];
		return (returnAll ? dashboards : dashboards.slice(0, limit)).map((entry) =>
			toItem(entry, itemIndex),
		);
	}
	if (operation === 'create') {
		const folder = getRequiredParameter(context, 'folderId', itemIndex, 'Folder');
		const body = createBody(context, itemIndex);
		const response = await openObserveApiRequest.call(context, {
			method: 'POST',
			pathSegments: ['dashboards'],
			query: { folder },
			body,
			itemIndex,
		});
		return [toItem(response, itemIndex)];
	}
	const dashboardId = getRequiredParameter(context, 'dashboardId', itemIndex, 'Dashboard ID');
	const folder = getRequiredParameter(context, 'folderId', itemIndex, 'Folder');
	if (operation === 'get') {
		const response = await openObserveApiRequest.call(context, {
			pathSegments: ['dashboards', dashboardId],
			query: { folder },
			itemIndex,
		});
		return [toItem(response, itemIndex)];
	}
	if (operation === 'update') {
		const current = (await openObserveApiRequest.call(context, {
			pathSegments: ['dashboards', dashboardId],
			query: { folder },
			itemIndex,
		})) as DashboardEnvelope;
		const version = current.version;
		if (!Number.isInteger(version) || version === undefined)
			throw new OpenObserveValidationError(`Dashboard version is missing at item ${itemIndex}`);
		const definition = current[`v${version}`];
		if (!definition || typeof definition !== 'object' || Array.isArray(definition))
			throw new OpenObserveValidationError(
				`Current dashboard definition is missing at item ${itemIndex}`,
			);
		if (!current.hash)
			throw new OpenObserveValidationError(
				`Dashboard conflict hash is missing at item ${itemIndex}`,
			);
		const response = await openObserveApiRequest.call(context, {
			method: 'PUT',
			pathSegments: ['dashboards', dashboardId],
			query: { folder, hash: current.hash },
			body: updateBody(context, itemIndex, definition as IDataObject),
			itemIndex,
		});
		return [toItem(response, itemIndex)];
	}
	if (operation !== 'delete')
		throw new OpenObserveValidationError(
			`Unsupported Dashboard operation "${operation}" at item ${itemIndex}`,
		);
	if (!getParameter(context, 'confirmDestructive', itemIndex, false))
		throw new OpenObserveValidationError(`Confirm dashboard deletion at item ${itemIndex}`);
	const response = await openObserveApiRequest.call(context, {
		method: 'DELETE',
		pathSegments: ['dashboards', dashboardId],
		query: { folder },
		itemIndex,
	});
	return [toItem(response, itemIndex)];
}
