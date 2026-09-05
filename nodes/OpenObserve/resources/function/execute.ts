import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { requireJsonArray, requireJsonObject } from '../../shared/json';
import { requireNonNegativeSafeInteger, requirePositiveSafeInteger } from '../../shared/numbers';
import { openObserveApiRequest } from '../../shared/transport';
import { OpenObserveValidationError } from '../../shared/validation-error';
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
) => {
	const value = String(context.getNodeParameter(name, itemIndex, '')).trim();
	if (!value) throw new OpenObserveValidationError(`${label} is required at item ${itemIndex}`);
	return value;
};
const toItem = (value: unknown, itemIndex: number): INodeExecutionData => ({
	json: (value && typeof value === 'object' ? value : { value }) as IDataObject,
	pairedItem: { item: itemIndex },
});
function functionBody(context: IExecuteFunctions, itemIndex: number, name: string): IDataObject {
	const advanced = requireJsonObject(
		context.getNodeParameter('advancedJson', itemIndex, '{}'),
		'Advanced Function JSON',
		itemIndex,
	);
	return {
		...advanced,
		name,
		function: getRequiredParameter(context, 'vrl', itemIndex, 'VRL'),
		params: getParameter(context, 'params', itemIndex, ''),
		numArgs: requireNonNegativeSafeInteger(
			getParameter(context, 'numArgs', itemIndex, 0),
			'Argument Count',
			itemIndex,
		),
		transType: 0,
	};
}
export async function executeFunction(
	context: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'getMany') {
		const returnAll = getParameter(context, 'returnAll', itemIndex, false);
		const limit = returnAll
			? undefined
			: requirePositiveSafeInteger(
					getParameter(context, 'limit', itemIndex, 50),
					'Limit',
					itemIndex,
				);
		const response = (await openObserveApiRequest.call(context, {
			pathSegments: ['functions'],
			itemIndex,
		})) as { list?: unknown[] };
		const list = Array.isArray(response.list) ? response.list : [];
		const selected = returnAll ? list : list.slice(0, limit);
		return selected.map((entry) => toItem(entry, itemIndex));
	}
	if (operation === 'validate') {
		const response = await openObserveApiRequest.call(context, {
			method: 'POST',
			pathSegments: ['functions', 'test'],
			body: {
				function: getRequiredParameter(context, 'vrl', itemIndex, 'VRL'),
				events: requireJsonArray(
					context.getNodeParameter('eventsJson', itemIndex, '[{}]'),
					'Sample Events JSON',
					itemIndex,
				),
				trans_type: 0,
			},
			itemIndex,
		});
		return [toItem(response, itemIndex)];
	}
	if (operation === 'create') {
		const name = getRequiredParameter(context, 'name', itemIndex, 'Name');
		const response = await openObserveApiRequest.call(context, {
			method: 'POST',
			pathSegments: ['functions'],
			body: functionBody(context, itemIndex, name),
			itemIndex,
		});
		return [toItem(response, itemIndex)];
	}
	const name = getRequiredParameter(context, 'functionName', itemIndex, 'Function name');
	if (operation === 'getDependencies') {
		const response = await openObserveApiRequest.call(context, {
			pathSegments: ['functions', name],
			itemIndex,
		});
		return [toItem(response, itemIndex)];
	}
	if (operation === 'update') {
		const response = await openObserveApiRequest.call(context, {
			method: 'PUT',
			pathSegments: ['functions', name],
			body: functionBody(context, itemIndex, name),
			itemIndex,
		});
		return [toItem(response, itemIndex)];
	}
	if (operation !== 'delete')
		throw new OpenObserveValidationError(
			`Unsupported Function operation "${operation}" at item ${itemIndex}`,
		);
	if (!getParameter(context, 'confirmDestructive', itemIndex, false))
		throw new OpenObserveValidationError(`Confirm function deletion at item ${itemIndex}`);
	const response = await openObserveApiRequest.call(context, {
		method: 'DELETE',
		pathSegments: ['functions', name],
		query: { force: false },
		itemIndex,
	});
	return [toItem(response, itemIndex)];
}
