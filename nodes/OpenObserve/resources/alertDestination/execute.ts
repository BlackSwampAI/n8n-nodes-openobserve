import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { requireJsonObject } from '../../shared/json';
import { requirePositiveSafeInteger } from '../../shared/numbers';
import { openObserveApiRequest } from '../../shared/transport';
import { OpenObserveValidationError } from '../../shared/validation-error';
/* eslint-disable @n8n/community-nodes/require-node-api-error -- Item-aware validation errors are normalized at the node boundary. */
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
	const value = String(getParameter(context, name, itemIndex, '')).trim();
	if (!value) throw new OpenObserveValidationError(`${label} is required at item ${itemIndex}`);
	return value;
};
function safeDestination(value: unknown): IDataObject {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return { value: String(value) };
	const copy = { ...(value as Record<string, unknown>) };
	if (copy.headers && typeof copy.headers === 'object')
		copy.headers = Object.fromEntries(
			Object.keys(copy.headers as object).map((key) => [key, '[REDACTED]']),
		);
	return copy as IDataObject;
}
const one = (value: unknown, itemIndex: number): INodeExecutionData[] => [
	{ json: safeDestination(value), pairedItem: { item: itemIndex } },
];
function validateUrl(value: string, itemIndex: number): string {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new OpenObserveValidationError(
			`URL must be a valid HTTP or HTTPS URL at item ${itemIndex}`,
		);
	}
	if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password)
		throw new OpenObserveValidationError(
			`URL must be HTTP or HTTPS and must not contain credentials at item ${itemIndex}`,
		);
	return parsed.toString();
}
function headers(value: unknown, itemIndex: number): Record<string, string> {
	const parsed = requireJsonObject(value, 'Headers JSON', itemIndex);
	const output: Record<string, string> = {};
	for (const [key, headerValue] of Object.entries(parsed)) {
		if (!key.trim() || typeof headerValue !== 'string')
			throw new OpenObserveValidationError(
				`Headers JSON must contain non-empty string keys and values at item ${itemIndex}`,
			);
		output[key] = headerValue;
	}
	return output;
}
export async function executeAlertDestination(
	context: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	if (operation === 'getMany') {
		const response = await openObserveApiRequest.call(context, {
			pathSegments: ['alerts', 'destinations'],
			query: { module: 'alert' },
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
		return selected.map((entry) => ({
			json: safeDestination(entry),
			pairedItem: { item: itemIndex },
		}));
	}
	if (operation === 'create') {
		const advanced = requireJsonObject(
			getParameter(context, 'destinationJson', itemIndex, '{}'),
			'Destination JSON',
			itemIndex,
		);
		const body = {
			...advanced,
			name: getRequiredParameter(context, 'name', itemIndex, 'Name'),
			type: 'http',
			template: getRequiredParameter(context, 'templateName', itemIndex, 'Template'),
			url: validateUrl(getRequiredParameter(context, 'url', itemIndex, 'URL'), itemIndex),
			method: getParameter(context, 'httpMethod', itemIndex, 'post'),
			headers: headers(getParameter(context, 'headersJson', itemIndex, '{}'), itemIndex),
			skip_tls_verify: getParameter(context, 'skipTlsVerify', itemIndex, false),
		};
		return one(
			await openObserveApiRequest.call(context, {
				method: 'POST',
				pathSegments: ['alerts', 'destinations'],
				query: { module: 'alert' },
				body,
				sensitiveValues: Object.values(body.headers),
				itemIndex,
			}),
			itemIndex,
		);
	}
	const name = getRequiredParameter(context, 'destinationName', itemIndex, 'Destination name');
	if (operation === 'get')
		return one(
			await openObserveApiRequest.call(context, {
				pathSegments: ['alerts', 'destinations', name],
				itemIndex,
			}),
			itemIndex,
		);
	if (operation === 'update') {
		const current = (await openObserveApiRequest.call(context, {
			pathSegments: ['alerts', 'destinations', name],
			itemIndex,
		})) as Record<string, unknown>;
		const advanced = requireJsonObject(
			getParameter(context, 'destinationJson', itemIndex, '{}'),
			'Update JSON',
			itemIndex,
		);
		const mergedBody: Record<string, unknown> = { ...current, ...advanced, name };
		const mergedHeaders =
			mergedBody.headers && typeof mergedBody.headers === 'object'
				? Object.values(mergedBody.headers as Record<string, unknown>).filter(
						(value): value is string => typeof value === 'string',
					)
				: [];
		return one(
			await openObserveApiRequest.call(context, {
				method: 'PUT',
				pathSegments: ['alerts', 'destinations', name],
				query: { module: 'alert' },
				body: mergedBody,
				sensitiveValues: mergedHeaders,
				itemIndex,
			}),
			itemIndex,
		);
	}
	if (operation !== 'delete')
		throw new OpenObserveValidationError(
			`Unsupported Alert Destination operation "${operation}" at item ${itemIndex}`,
		);
	if (!getParameter(context, 'confirmDestructive', itemIndex, false))
		throw new OpenObserveValidationError(`Confirm destination deletion at item ${itemIndex}`);
	return one(
		await openObserveApiRequest.call(context, {
			method: 'DELETE',
			pathSegments: ['alerts', 'destinations', name],
			itemIndex,
		}),
		itemIndex,
	);
}
