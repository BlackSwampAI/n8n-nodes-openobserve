import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { logProperties } from './resources/log/descriptions';
import { ingestLogItem, ingestManyLogs } from './resources/log/execute';
import { streamProperties } from './resources/stream/descriptions';
import { executeStreamItem, getManyStreams } from './resources/stream/execute';
import type { StreamListResponse, StreamType } from './resources/stream/types';
import { normalizeOpenObserveError } from './shared/errors';
import { openObserveApiRequest } from './shared/transport';

function safeFailure(error: unknown, itemIndex?: number | number[]): INodeExecutionData {
	const message = error instanceof Error ? error.message : 'OpenObserve operation failed';
	const pairedItem = Array.isArray(itemIndex)
		? itemIndex.map((item) => ({ item }))
		: itemIndex === undefined
			? undefined
			: { item: itemIndex };
	return {
		json: { error: message },
		...(pairedItem === undefined ? {} : { pairedItem }),
	};
}

function executionError(context: IExecuteFunctions, error: unknown, itemIndex?: number) {
	return error instanceof NodeApiError || error instanceof NodeOperationError
		? error
		: normalizeOpenObserveError(context.getNode(), error, { itemIndex });
}

export class OpenObserve implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'OpenObserve',
		name: 'openObserve',
		icon: { light: 'file:openobserve.svg', dark: 'file:openobserve.dark.svg' },
		group: ['transform'],
		version: 1,
		description: 'Manage streams and ingest structured logs in OpenObserve',
		subtitle: '={{$parameter["resource"] + ": " + $parameter["operation"]}}',
		defaults: { name: 'OpenObserve' },
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		usableAsTool: true,
		credentials: [{ name: 'openObserveApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Log', value: 'log' },
					{ name: 'Stream', value: 'stream' },
				],
				default: 'stream',
			},
			...streamProperties,
			...logProperties,
		],
	};

	methods = {
		listSearch: {
			async searchStreams(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const resource = this.getNodeParameter('resource', 'stream') as string;
				const type =
					resource === 'log' ? 'logs' : (this.getNodeParameter('streamType', 'logs') as StreamType);
				const response = (await openObserveApiRequest.call(this, {
					pathSegments: ['streams'],
					query: { type, limit: 100, offset: 0, ...(filter ? { keyword: filter } : {}) },
				})) as StreamListResponse;
				return {
					results: (response.list ?? []).map((stream) => ({
						name: stream.name,
						value: stream.name,
					})),
				};
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const input = this.getInputData();
		const resource = this.getNodeParameter('resource', 0) as 'log' | 'stream';
		const operation = this.getNodeParameter('operation', 0) as string;

		try {
			if (resource === 'stream' && operation === 'getMany') return [await getManyStreams(this)];
			if (resource === 'log' && operation === 'ingestMany') {
				return [[await ingestManyLogs(this, input)]];
			}
		} catch (error) {
			const normalized = executionError(this, error);
			if (this.continueOnFail()) {
				return [
					[
						safeFailure(
							normalized,
							input.map((_item, itemIndex) => itemIndex),
						),
					],
				];
			}
			throw normalized;
		}

		const output: INodeExecutionData[] = [];
		for (let itemIndex = 0; itemIndex < input.length; itemIndex++) {
			try {
				output.push(
					resource === 'stream'
						? await executeStreamItem(this, operation, itemIndex)
						: await ingestLogItem(this, itemIndex),
				);
			} catch (error) {
				const normalized = executionError(this, error, itemIndex);
				if (!this.continueOnFail()) throw normalized;
				output.push(safeFailure(normalized, itemIndex));
			}
		}
		return [output];
	}
}
