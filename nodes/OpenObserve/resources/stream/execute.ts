import type { IExecuteFunctions, INodeExecutionData, IDataObject } from 'n8n-workflow';

import { requireJsonArray, requireJsonObject } from '../../shared/json';
import { collectPaginated } from '../../shared/pagination';
import { openObserveApiRequest } from '../../shared/transport';
import { OpenObserveValidationError } from '../../shared/validation-error';
import type { StreamListResponse, StreamSummary, StreamType } from './types';

function streamType(context: IExecuteFunctions, itemIndex: number): StreamType {
	return context.getNodeParameter('streamType', itemIndex, 'logs') as StreamType;
}

function streamName(context: IExecuteFunctions, itemIndex: number): string {
	const value = context.getNodeParameter('streamName', itemIndex, '') as string;
	if (!value.trim())
		throw new OpenObserveValidationError(`Stream name is required at item ${itemIndex}`);
	return value.trim();
}

function asItem(value: unknown, itemIndex?: number): INodeExecutionData {
	const json =
		value !== null && typeof value === 'object' && !Array.isArray(value)
			? (value as IDataObject)
			: ({ value } as IDataObject);
	return { json, ...(itemIndex === undefined ? {} : { pairedItem: { item: itemIndex } }) };
}

export async function getManyStreams(context: IExecuteFunctions): Promise<INodeExecutionData[]> {
	const returnAll = context.getNodeParameter('returnAll', 0, false) as boolean;
	const limit = returnAll ? undefined : (context.getNodeParameter('limit', 0, 50) as number);
	const type = streamType(context, 0);
	const keyword = (context.getNodeParameter('keyword', 0, '') as string).trim();
	const sort = (context.getNodeParameter('sort', 0, '') as string).trim();
	const fetchPage = async (offset: number, remaining?: number) => {
		const pageLimit = Math.min(remaining ?? 100, 100);
		const response = (await openObserveApiRequest.call(context, {
			pathSegments: ['streams'],
			query: {
				type,
				offset,
				limit: pageLimit,
				...(keyword ? { keyword } : {}),
				...(sort ? { sort } : {}),
			},
		})) as StreamListResponse;
		const list = Array.isArray(response.list) ? response.list : [];
		const nextOffset = offset + list.length;
		return { items: list, nextCursor: nextOffset < response.total ? nextOffset : undefined };
	};
	const streams = returnAll
		? await collectPaginated<StreamSummary, number>({
				returnAll: true,
				initialCursor: 0,
				fetchPage,
			})
		: await collectPaginated<StreamSummary, number>({
				returnAll: false,
				limit: limit as number,
				initialCursor: 0,
				fetchPage,
			});
	return streams.map((stream) => asItem(stream));
}

export async function executeStreamItem(
	context: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData> {
	const type = streamType(context, itemIndex);
	const name = streamName(context, itemIndex);
	if (operation === 'create') {
		const fields = requireJsonArray(
			context.getNodeParameter('fieldsJson', itemIndex, '[]'),
			'Fields JSON',
			itemIndex,
		);
		const settings = requireJsonObject(
			context.getNodeParameter('settingsJson', itemIndex, '{}'),
			'Settings JSON',
			itemIndex,
		);
		const response = await openObserveApiRequest.call(context, {
			method: 'POST',
			pathSegments: ['streams', name],
			query: { type },
			body: { fields, settings },
			itemIndex,
		});
		return asItem(response, itemIndex);
	}
	if (operation === 'getSchema') {
		const keyword = (context.getNodeParameter('keyword', itemIndex, '') as string).trim();
		const response = await openObserveApiRequest.call(context, {
			pathSegments: ['streams', name, 'schema'],
			query: { type, ...(keyword ? { keyword } : {}) },
			itemIndex,
		});
		return asItem(response, itemIndex);
	}
	if (operation === 'updateSettings') {
		const body = requireJsonObject(
			context.getNodeParameter('settingsJson', itemIndex, '{}'),
			'Settings JSON',
			itemIndex,
		);
		if (!Object.keys(body).length)
			throw new OpenObserveValidationError(`Settings JSON must not be empty at item ${itemIndex}`);
		const response = await openObserveApiRequest.call(context, {
			method: 'PUT',
			pathSegments: ['streams', name, 'settings'],
			query: { type },
			body,
			itemIndex,
		});
		return asItem(response, itemIndex);
	}
	if (operation !== 'deleteFields' && operation !== 'delete') {
		throw new OpenObserveValidationError(
			`Unsupported Stream operation "${operation}" at item ${itemIndex}`,
		);
	}
	const confirmed = context.getNodeParameter('confirmDestructive', itemIndex, false) as boolean;
	if (!confirmed)
		throw new OpenObserveValidationError(`Confirm the destructive operation at item ${itemIndex}`);
	if (operation === 'deleteFields') {
		const fields = (context.getNodeParameter('fields', itemIndex, '') as string)
			.split(',')
			.map((field) => field.trim())
			.filter(Boolean);
		if (!fields.length) {
			throw new OpenObserveValidationError(`At least one field is required at item ${itemIndex}`);
		}
		const response = await openObserveApiRequest.call(context, {
			method: 'PUT',
			pathSegments: ['streams', name, 'delete_fields'],
			query: { type },
			body: { fields },
			itemIndex,
		});
		return asItem(response, itemIndex);
	}
	const deleteAll = context.getNodeParameter('deleteAll', itemIndex, false) as boolean;
	const response = await openObserveApiRequest.call(context, {
		method: 'DELETE',
		pathSegments: ['streams', name],
		query: { type, delete_all: deleteAll },
		itemIndex,
	});
	return asItem(response, itemIndex);
}
