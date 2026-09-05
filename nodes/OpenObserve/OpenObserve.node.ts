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
import { metricProperties } from './resources/metric/descriptions';
import { executeMetric, ingestManyMetrics, ingestMetric } from './resources/metric/execute';
import { searchProperties } from './resources/search/descriptions';
import { executeSearch } from './resources/search/execute';
import { streamProperties } from './resources/stream/descriptions';
import { executeStreamItem, getManyStreams } from './resources/stream/execute';
import type { StreamListResponse, StreamType } from './resources/stream/types';
import { traceProperties } from './resources/trace/descriptions';
import { executeTrace } from './resources/trace/execute';
import { functionProperties } from './resources/function/descriptions';
import { executeFunction } from './resources/function/execute';
import { dashboardProperties } from './resources/dashboard/descriptions';
import { executeDashboard } from './resources/dashboard/execute';
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
		description: 'Manage and query observability data in OpenObserve',
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
					{ name: 'Dashboard', value: 'dashboard' },
					{ name: 'Function', value: 'function' },
					{ name: 'Log', value: 'log' },
					{ name: 'Metric', value: 'metric' },
					{ name: 'Search', value: 'search' },
					{ name: 'Stream', value: 'stream' },
					{ name: 'Trace', value: 'trace' },
				],
				default: 'stream',
			},
			...streamProperties,
			...logProperties,
			...searchProperties,
			...metricProperties,
			...traceProperties,
			...functionProperties,
			...dashboardProperties,
		],
	};

	methods = {
		listSearch: {
			async searchFunctions(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const response = (await openObserveApiRequest.call(this, {
					pathSegments: ['functions'],
				})) as { list?: Array<{ name?: string }> };
				const needle = (filter ?? '').toLowerCase();
				return {
					results: (response.list ?? [])
						.filter((entry) => entry.name && entry.name.toLowerCase().includes(needle))
						.map((entry) => ({ name: entry.name as string, value: entry.name as string })),
				};
			},
			async searchDashboards(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const selectedFolder = this.getNodeParameter('folderId', 'default');
				const folder =
					typeof selectedFolder === 'object' && selectedFolder !== null && 'value' in selectedFolder
						? String(selectedFolder.value || 'default')
						: String(selectedFolder || 'default');
				const response = (await openObserveApiRequest.call(this, {
					pathSegments: ['dashboards'],
					query: { folder, ...(filter ? { title: filter, pageSize: 100 } : {}) },
				})) as {
					dashboards?: Array<{ dashboard_id?: string; title?: string; folder_name?: string }>;
				};
				return {
					results: (response.dashboards ?? [])
						.filter((entry) => entry.dashboard_id)
						.map((entry) => ({
							name: `${entry.title || entry.dashboard_id}${entry.folder_name ? ` (${entry.folder_name})` : ''}`,
							value: entry.dashboard_id as string,
						})),
				};
			},
			async searchDashboardFolders(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const response = (await openObserveApiRequest.call(this, {
					apiPathMode: 'v2',
					pathSegments: ['folders', 'dashboards'],
				})) as { list?: Array<{ folderId?: string; name?: string }> };
				const needle = (filter ?? '').toLowerCase();
				const results = [
					...(needle && !'default'.includes(needle) ? [] : [{ name: 'Default', value: 'default' }]),
					...(response.list ?? [])
						.filter((entry) => entry.folderId && entry.name?.toLowerCase().includes(needle))
						.map((entry) => ({ name: entry.name as string, value: entry.folderId as string })),
				];
				return {
					results: [...new Map(results.map((entry) => [entry.value, entry])).values()],
				};
			},
			async searchStreams(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const resource = this.getNodeParameter('resource', 'stream') as string;
				const operation = this.getNodeParameter('operation', '') as string;
				const type =
					resource === 'log' || (resource === 'search' && operation === 'searchAround')
						? 'logs'
						: resource === 'search'
							? (this.getNodeParameter('streamType', 'logs') as StreamType)
							: resource === 'metric'
								? 'metrics'
								: resource === 'trace'
									? 'traces'
									: (this.getNodeParameter('streamType', 'logs') as StreamType);
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
		const resource = this.getNodeParameter('resource', 0) as
			| 'dashboard'
			| 'function'
			| 'log'
			| 'metric'
			| 'search'
			| 'stream'
			| 'trace';
		const operation = this.getNodeParameter('operation', 0) as string;

		try {
			if (resource === 'stream' && operation === 'getMany') return [await getManyStreams(this)];
			if (resource === 'log' && operation === 'ingestMany') {
				return [[await ingestManyLogs(this, input)]];
			}
			if (resource === 'metric' && operation === 'ingestMany') {
				return [[await ingestManyMetrics(this, input)]];
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
				if (resource === 'stream') output.push(await executeStreamItem(this, operation, itemIndex));
				else if (resource === 'log') output.push(await ingestLogItem(this, itemIndex));
				else if (resource === 'metric' && operation === 'ingest')
					output.push(await ingestMetric(this, itemIndex));
				else if (resource === 'metric')
					output.push(...(await executeMetric(this, operation, itemIndex)));
				else if (resource === 'search')
					output.push(...(await executeSearch(this, operation, itemIndex)));
				else if (resource === 'trace')
					output.push(...(await executeTrace(this, operation, itemIndex)));
				else if (resource === 'function')
					output.push(...(await executeFunction(this, operation, itemIndex)));
				else output.push(...(await executeDashboard(this, operation, itemIndex)));
			} catch (error) {
				const normalized = executionError(this, error, itemIndex);
				if (!this.continueOnFail()) throw normalized;
				output.push(safeFailure(normalized, itemIndex));
			}
		}
		return [output];
	}
}
