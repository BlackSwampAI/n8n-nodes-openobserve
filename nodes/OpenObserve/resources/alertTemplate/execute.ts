import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { requireJsonObject } from '../../shared/json';
import { normalizeLocatorValue } from '../../shared/locator';
import { requirePositiveSafeInteger } from '../../shared/numbers';
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
const items = (values: unknown[], itemIndex: number): INodeExecutionData[] =>
	values.map((value) => ({ json: value as IDataObject, pairedItem: { item: itemIndex } }));
const one = (value: unknown, itemIndex: number): INodeExecutionData[] => [
	{
		json: (value && typeof value === 'object' ? value : { value }) as IDataObject,
		pairedItem: { item: itemIndex },
	},
];

export async function executeAlertTemplate(
	context: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'getMany' || operation === 'getPrebuilt') {
		const response = await openObserveApiRequest.call(context, {
			pathSegments:
				operation === 'getPrebuilt'
					? ['alerts', 'templates', 'system', 'prebuilt']
					: ['alerts', 'templates'],
			itemIndex,
		});
		const list = Array.isArray(response) ? response : [];
		const returnAll = getParameter(context, 'returnAll', itemIndex, false);
		const selected = returnAll
			? list
			: list.slice(
					0,
					requirePositiveSafeInteger(
						getParameter(context, 'limit', itemIndex, 50),
						'Limit',
						itemIndex,
					),
				);
		return items(selected, itemIndex);
	}
	if (operation === 'create') {
		const advanced = requireJsonObject(
			getParameter(context, 'templateJson', itemIndex, '{}'),
			'Template JSON',
			itemIndex,
		);
		const response = await openObserveApiRequest.call(context, {
			method: 'POST',
			pathSegments: ['alerts', 'templates'],
			body: {
				...advanced,
				name: getRequiredParameter(context, 'name', itemIndex, 'Name'),
				type: getParameter(context, 'templateType', itemIndex, 'http'),
				title: getParameter(context, 'title', itemIndex, ''),
				body: getRequiredParameter(context, 'body', itemIndex, 'Body'),
				isPrebuilt: false,
			},
			itemIndex,
		});
		return one(response, itemIndex);
	}
	const name = getRequiredParameter(context, 'templateName', itemIndex, 'Template name');
	if (operation === 'get')
		return one(
			await openObserveApiRequest.call(context, {
				pathSegments: ['alerts', 'templates', name],
				itemIndex,
			}),
			itemIndex,
		);
	if (operation === 'update') {
		const current = (await openObserveApiRequest.call(context, {
			pathSegments: ['alerts', 'templates', name],
			itemIndex,
		})) as Record<string, unknown>;
		const advanced = requireJsonObject(
			getParameter(context, 'templateJson', itemIndex, '{}'),
			'Update JSON',
			itemIndex,
		);
		if (current.isPrebuilt === true)
			throw new OpenObserveValidationError(
				`Prebuilt templates cannot be updated at item ${itemIndex}`,
			);
		const body: Record<string, unknown> = { ...current, ...advanced, name };
		body.isPrebuilt = current.isPrebuilt;
		body.isDefault = current.isDefault;
		if ('kind' in current) body.kind = current.kind;
		else delete body.kind;
		return one(
			await openObserveApiRequest.call(context, {
				method: 'PUT',
				pathSegments: ['alerts', 'templates', name],
				body,
				itemIndex,
			}),
			itemIndex,
		);
	}
	if (operation !== 'delete')
		throw new OpenObserveValidationError(
			`Unsupported Alert Template operation "${operation}" at item ${itemIndex}`,
		);
	if (!getParameter(context, 'confirmDestructive', itemIndex, false))
		throw new OpenObserveValidationError(`Confirm template deletion at item ${itemIndex}`);
	return one(
		await openObserveApiRequest.call(context, {
			method: 'DELETE',
			pathSegments: ['alerts', 'templates', name],
			itemIndex,
		}),
		itemIndex,
	);
}
