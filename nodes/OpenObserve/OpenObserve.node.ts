import type {
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodeListSearchResult,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import { logProperties } from './resources/log/descriptions';
import { ingestLogItem, ingestManyLogs } from './resources/log/execute';
import { metricProperties } from './resources/metric/descriptions';
import { executeMetric } from './resources/metric/execute';
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
import { alertTemplateProperties } from './resources/alertTemplate/descriptions';
import { executeAlertTemplate } from './resources/alertTemplate/execute';
import { alertDestinationProperties } from './resources/alertDestination/descriptions';
import { executeAlertDestination } from './resources/alertDestination/execute';
import { alertProperties } from './resources/alert/descriptions';
import { executeAlert } from './resources/alert/execute';
import { pipelineProperties } from './resources/pipeline/descriptions';
import { executePipeline } from './resources/pipeline/execute';
import { normalizeOpenObserveError } from './shared/errors';
import { normalizeLocatorValue } from './shared/locator';
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
					{ name: 'Alert', value: 'alert' },
					{ name: 'Alert Destination', value: 'alertDestination' },
					{ name: 'Alert Template', value: 'alertTemplate' },
					{ name: 'Dashboard', value: 'dashboard' },
					{ name: 'Function', value: 'function' },
					{ name: 'Log', value: 'log' },
					{ name: 'Metric', value: 'metric' },
					{ name: 'Pipeline', value: 'pipeline' },
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
			...alertTemplateProperties,
			...alertDestinationProperties,
			...alertProperties,
			...pipelineProperties,
		],
	};

	methods = {
		loadOptions: {
			async getAlertDestinations(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = await openObserveApiRequest.call(this, {
					pathSegments: ['alerts', 'destinations'],
					query: { module: 'alert' },
				});
				return (Array.isArray(response) ? response : [])
					.filter(
						(entry): entry is { name: string } =>
							typeof entry === 'object' &&
							entry !== null &&
							typeof (entry as { name?: unknown }).name === 'string',
					)
					.map((entry) => ({ name: entry.name, value: entry.name }));
			},
		},
		listSearch: {
			async searchPipelines(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const response = (await openObserveApiRequest.call(this, {
					pathSegments: ['pipelines'],
				})) as { list?: unknown[] };
				const needle = (filter ?? '').toLowerCase();
				return {
					results: (response.list ?? [])
						.filter(
							(entry): entry is { pipeline_id: string; name?: string; kind?: string } =>
								typeof entry === 'object' &&
								entry !== null &&
								!Array.isArray(entry) &&
								typeof (entry as { pipeline_id?: unknown }).pipeline_id === 'string' &&
								Boolean((entry as { pipeline_id: string }).pipeline_id.trim()) &&
								(entry as { kind?: string }).kind !== 'evaluation' &&
								(typeof (entry as { name?: unknown }).name !== 'string' ||
									(entry as { name: string }).name.toLowerCase().includes(needle)),
						)
						.map((entry) => ({
							name: entry.name || (entry.pipeline_id as string),
							value: entry.pipeline_id as string,
						})),
				};
			},
			async searchAlertFolders(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const response = (await openObserveApiRequest.call(this, {
					apiPathMode: 'v2',
					pathSegments: ['folders', 'alerts'],
				})) as { list?: Array<{ folderId?: string; name?: string }> };
				const needle = (filter ?? '').toLowerCase();
				const results = [
					...(needle && !'default'.includes(needle) ? [] : [{ name: 'Default', value: 'default' }]),
					...(response.list ?? [])
						.filter(
							(entry) =>
								entry.folderId &&
								entry.folderId !== 'default' &&
								entry.name?.toLowerCase().includes(needle),
						)
						.map((entry) => ({ name: entry.name as string, value: entry.folderId as string })),
				];
				return { results: [...new Map(results.map((entry) => [entry.value, entry])).values()] };
			},
			async searchAlertTemplates(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const response = await openObserveApiRequest.call(this, {
					pathSegments: ['alerts', 'templates'],
				});
				const needle = (filter ?? '').toLowerCase();
				return {
					results: (Array.isArray(response) ? response : [])
						.filter(
							(entry): entry is { name: string } =>
								typeof entry === 'object' &&
								entry !== null &&
								typeof (entry as { name?: unknown }).name === 'string' &&
								(entry as { name: string }).name.toLowerCase().includes(needle),
						)
						.map((entry) => ({ name: entry.name, value: entry.name })),
				};
			},
			async searchAlertDestinations(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const response = await openObserveApiRequest.call(this, {
					pathSegments: ['alerts', 'destinations'],
					query: { module: 'alert' },
				});
				const needle = (filter ?? '').toLowerCase();
				return {
					results: (Array.isArray(response) ? response : [])
						.filter(
							(entry): entry is { name: string } =>
								typeof entry === 'object' &&
								entry !== null &&
								typeof (entry as { name?: unknown }).name === 'string' &&
								(entry as { name: string }).name.toLowerCase().includes(needle),
						)
						.map((entry) => ({ name: entry.name, value: entry.name })),
				};
			},
			async searchAlerts(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const folder = normalizeLocatorValue(
					this.getNodeParameter('alertFolder', 'default'),
					'Alert folder',
					0,
					{ fallback: 'default' },
				);
				const response = (await openObserveApiRequest.call(this, {
					apiPathMode: 'v2',
					pathSegments: ['alerts'],
					query: {
						folder,
						page_size: 100,
						page_idx: 0,
						...(filter ? { alert_name_substring: filter } : {}),
					},
				})) as { list?: Array<{ id?: string; name?: string }> };
				return {
					results: (response.list ?? [])
						.filter((entry) => entry.id)
						.map((entry) => ({
							name: entry.name || (entry.id as string),
							value: entry.id as string,
						})),
				};
			},
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
				const folder = normalizeLocatorValue(
					this.getNodeParameter('folderId', 'default'),
					'Dashboard folder',
					0,
					{ fallback: 'default' },
				);
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
			| 'alert'
			| 'alertDestination'
			| 'alertTemplate'
			| 'dashboard'
			| 'function'
			| 'log'
			| 'metric'
			| 'pipeline'
			| 'search'
			| 'stream'
			| 'trace';
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
				if (resource === 'stream') output.push(await executeStreamItem(this, operation, itemIndex));
				else if (resource === 'log') output.push(await ingestLogItem(this, itemIndex));
				else if (resource === 'metric')
					output.push(...(await executeMetric(this, operation, itemIndex)));
				else if (resource === 'search')
					output.push(...(await executeSearch(this, operation, itemIndex)));
				else if (resource === 'trace')
					output.push(...(await executeTrace(this, operation, itemIndex)));
				else if (resource === 'function')
					output.push(...(await executeFunction(this, operation, itemIndex)));
				else if (resource === 'dashboard')
					output.push(...(await executeDashboard(this, operation, itemIndex)));
				else if (resource === 'alertTemplate')
					output.push(...(await executeAlertTemplate(this, operation, itemIndex)));
				else if (resource === 'alertDestination')
					output.push(...(await executeAlertDestination(this, operation, itemIndex)));
				else if (resource === 'pipeline')
					output.push(...(await executePipeline(this, operation, itemIndex)));
				else output.push(...(await executeAlert(this, operation, itemIndex)));
			} catch (error) {
				const normalized = executionError(this, error, itemIndex);
				if (!this.continueOnFail()) throw normalized;
				output.push(safeFailure(normalized, itemIndex));
			}
		}
		return [output];
	}
}
