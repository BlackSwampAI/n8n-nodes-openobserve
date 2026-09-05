import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';

import { requireJsonObject, type JsonRecord } from '../../shared/json';
import { normalizeLocatorValue } from '../../shared/locator';
import { openObserveApiRequest } from '../../shared/transport';
import { OpenObserveValidationError } from '../../shared/validation-error';

interface IngestStatus {
	name?: string;
	successful?: number;
	failed?: number;
}

interface IngestResponse extends IDataObject {
	code?: number;
	status?: IngestStatus[];
}

function requireStreamName(context: IExecuteFunctions, itemIndex: number): string {
	return normalizeLocatorValue(
		context.getNodeParameter('streamName', itemIndex, ''),
		'Stream name',
		itemIndex,
	);
}

function ingestionResult(
	response: IngestResponse,
	requestedStreamName: string,
	records: number,
): IDataObject {
	const status = Array.isArray(response.status) ? response.status : [];
	const streamName = status.find((entry) => entry.name)?.name ?? requestedStreamName;
	const successful = status.reduce((total, entry) => total + (entry.successful ?? 0), 0);
	const failed = status.reduce((total, entry) => total + (entry.failed ?? 0), 0);
	return {
		...response,
		requestedStreamName,
		streamName,
		records,
		successful,
		failed,
		partialFailure: failed > 0,
	};
}

export async function ingestLogItem(
	context: IExecuteFunctions,
	itemIndex: number,
): Promise<INodeExecutionData> {
	const name = requireStreamName(context, itemIndex);
	const record = requireJsonObject(
		context.getNodeParameter('recordJson', itemIndex, '{}'),
		'Record JSON',
		itemIndex,
	);
	const response = (await openObserveApiRequest.call(context, {
		method: 'POST',
		pathSegments: [name, '_json'],
		body: [record],
		itemIndex,
	})) as IngestResponse;
	return { json: ingestionResult(response, name, 1), pairedItem: { item: itemIndex } };
}

export async function ingestManyLogs(
	context: IExecuteFunctions,
	input: INodeExecutionData[],
): Promise<INodeExecutionData> {
	if (!input.length)
		throw new OpenObserveValidationError('Ingest Many requires at least one input item');
	const name = requireStreamName(context, 0);
	const records: JsonRecord[] = input.map((item, itemIndex) =>
		requireJsonObject(item.json, 'Input item JSON', itemIndex),
	);
	const response = (await openObserveApiRequest.call(context, {
		method: 'POST',
		pathSegments: [name, '_json'],
		body: records,
	})) as IngestResponse;
	return {
		json: ingestionResult(response, name, records.length),
		pairedItem: input.map((_item, item) => ({ item })),
	};
}
