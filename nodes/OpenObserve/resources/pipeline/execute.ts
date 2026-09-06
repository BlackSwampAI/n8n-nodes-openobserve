import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { requireJsonObject } from '../../shared/json';
import { normalizeLocatorValue } from '../../shared/locator';
import { requirePositiveSafeInteger } from '../../shared/numbers';
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
const required = (context: IExecuteFunctions, name: string, itemIndex: number, label: string) => {
	return normalizeLocatorValue(getParameter(context, name, itemIndex, ''), label, itemIndex);
};
const items = (values: unknown[], itemIndex: number): INodeExecutionData[] =>
	values.map((value) => ({
		json: (value && typeof value === 'object' ? value : { value }) as IDataObject,
		pairedItem: { item: itemIndex },
	}));

function isMissingTriggersHistory(error: unknown): boolean {
	if (!error || typeof error !== 'object') return false;
	const candidate = error as {
		httpCode?: unknown;
		statusCode?: unknown;
		message?: unknown;
		description?: unknown;
	};
	const status = candidate.httpCode ?? candidate.statusCode;
	const detail = `${String(candidate.message ?? '')} ${String(candidate.description ?? '')}`;
	return String(status) === '500' && /Search stream not found:\s*triggers/i.test(detail);
}

function visibleUserPipelines(response: unknown, itemIndex: number): IDataObject[] {
	if (
		!response ||
		typeof response !== 'object' ||
		!Array.isArray((response as { list?: unknown }).list)
	)
		throw new OpenObserveValidationError(
			`Pipeline list response is malformed at item ${itemIndex}`,
		);
	return (response as { list: unknown[] }).list.filter(
		(entry): entry is IDataObject =>
			typeof entry === 'object' &&
			entry !== null &&
			!Array.isArray(entry) &&
			typeof (entry as IDataObject).pipeline_id === 'string' &&
			Boolean(String((entry as IDataObject).pipeline_id).trim()) &&
			(entry as IDataObject).kind !== 'evaluation',
	);
}

async function requireVisibleUserPipeline(
	context: IExecuteFunctions,
	pipelineId: string,
	itemIndex: number,
): Promise<void> {
	const response = await openObserveApiRequest.call(context, {
		pathSegments: ['pipelines'],
		itemIndex,
	});
	const visible = visibleUserPipelines(response, itemIndex);
	const listed = (response as { list: unknown[] }).list;
	if (
		listed.some(
			(entry) =>
				typeof entry === 'object' &&
				entry !== null &&
				!Array.isArray(entry) &&
				(entry as IDataObject).pipeline_id === pipelineId &&
				(entry as IDataObject).kind === 'evaluation',
		)
	)
		throw new OpenObserveValidationError(
			`System evaluation pipeline ${pipelineId} cannot be mutated at item ${itemIndex}`,
		);
	if (!visible.some((pipeline) => pipeline.pipeline_id === pipelineId))
		throw new OpenObserveValidationError(
			`Pipeline ${pipelineId} is not present in the user-visible pipeline list at item ${itemIndex}`,
		);
}

function validatePipeline(body: IDataObject, itemIndex: number): IDataObject {
	const pipelineName = String(body.name ?? '').trim();
	if (!pipelineName) throw new OpenObserveValidationError(`Name is required at item ${itemIndex}`);
	if (pipelineName !== pipelineName.toLowerCase())
		throw new OpenObserveValidationError(`Pipeline name must be lowercase at item ${itemIndex}`);
	if (!Array.isArray(body.nodes) || !Array.isArray(body.edges))
		throw new OpenObserveValidationError(
			`Pipeline nodes and edges must be arrays at item ${itemIndex}`,
		);
	const ids = new Set<string>();
	const edgeIds = new Set<string>();
	const inputNodeTypes: string[] = [];
	for (const raw of body.nodes) {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw))
			throw new OpenObserveValidationError(
				`Every pipeline node must be an object at item ${itemIndex}`,
			);
		const node = raw as Record<string, unknown>;
		const id = String(node.id ?? '').trim();
		if (!id || ids.has(id))
			throw new OpenObserveValidationError(
				`Pipeline node IDs must be non-empty and unique at item ${itemIndex}`,
			);
		ids.add(id);
		if (
			!node.data ||
			typeof node.data !== 'object' ||
			Array.isArray(node.data) ||
			!node.position ||
			typeof node.position !== 'object' ||
			Array.isArray(node.position) ||
			!['input', 'output', 'default'].includes(String(node.io_type ?? ''))
		)
			throw new OpenObserveValidationError(
				`Pipeline nodes require data, position, and a supported io_type at item ${itemIndex}`,
			);
		const position = node.position as Record<string, unknown>;
		if (
			typeof position.x !== 'number' ||
			!Number.isFinite(position.x) ||
			typeof position.y !== 'number' ||
			!Number.isFinite(position.y)
		)
			throw new OpenObserveValidationError(
				`Pipeline node positions require finite numeric x and y at item ${itemIndex}`,
			);
		const data = node.data as Record<string, unknown> | undefined;
		if (node.io_type === 'input') inputNodeTypes.push(String(data?.node_type ?? ''));
		if (data?.node_type === 'remote_stream')
			throw new OpenObserveValidationError(
				`Remote pipeline destinations are not supported at item ${itemIndex}`,
			);
		if (
			data?.stream_type !== undefined &&
			!['logs', 'metrics', 'traces', 'enrichment_tables'].includes(String(data.stream_type))
		)
			throw new OpenObserveValidationError(`Unsupported pipeline stream type at item ${itemIndex}`);
	}
	for (const raw of body.edges) {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw))
			throw new OpenObserveValidationError(
				`Every pipeline edge must be an object at item ${itemIndex}`,
			);
		const edge = raw as Record<string, unknown>;
		const edgeId = String(edge.id ?? '').trim();
		if (!edgeId || edgeIds.has(edgeId))
			throw new OpenObserveValidationError(
				`Pipeline edge IDs must be non-empty and unique at item ${itemIndex}`,
			);
		edgeIds.add(edgeId);
		if (!ids.has(String(edge.source ?? '')) || !ids.has(String(edge.target ?? '')))
			throw new OpenObserveValidationError(
				`Pipeline edge endpoints must reference node IDs at item ${itemIndex}`,
			);
	}
	const source = body.source;
	if (!source || typeof source !== 'object' || Array.isArray(source))
		throw new OpenObserveValidationError(`Pipeline source must be an object at item ${itemIndex}`);
	if (!['realtime', 'scheduled'].includes(String((source as IDataObject).source_type ?? '')))
		throw new OpenObserveValidationError(
			`Pipeline source_type must be realtime or scheduled at item ${itemIndex}`,
		);
	const expectedInput = (source as IDataObject).source_type === 'scheduled' ? 'query' : 'stream';
	if (inputNodeTypes.length !== 1 || inputNodeTypes[0] !== expectedInput)
		throw new OpenObserveValidationError(
			`${String((source as IDataObject).source_type)} pipelines require exactly one ${expectedInput} input node at item ${itemIndex}`,
		);
	return body;
}

export async function executePipeline(
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
		const response = await openObserveApiRequest.call(context, {
			pathSegments: ['pipelines'],
			itemIndex,
		});
		const userPipelines = visibleUserPipelines(response, itemIndex);
		return items(returnAll ? userPipelines : userPipelines.slice(0, limit), itemIndex);
	}
	if (operation === 'getHistory') {
		const historyPipelineId = required(context, 'historyPipelineId', itemIndex, 'Pipeline');
		const returnAll = getParameter(context, 'returnAll', itemIndex, false);
		const limit = returnAll
			? undefined
			: requirePositiveSafeInteger(
					getParameter(context, 'limit', itemIndex, 50),
					'Limit',
					itemIndex,
				);
		const startRaw = getParameter(context, 'startTime', itemIndex, '');
		const endRaw = getParameter(context, 'endTime', itemIndex, '');
		const start = startRaw ? toOpenObserveMicroseconds(startRaw, { itemIndex }) : undefined;
		const end = endRaw ? toOpenObserveMicroseconds(endRaw, { itemIndex }) : undefined;
		if (start !== undefined && end !== undefined && start > end)
			throw new OpenObserveValidationError(
				`Start Time must not be after End Time at item ${itemIndex}`,
			);
		const mode = returnAll
			? ({ returnAll: true } as const)
			: ({ returnAll: false, limit: limit! } as const);
		const rows = await collectPaginated({
			...mode,
			initialCursor: 0,
			fetchPage: async (offset, remaining) => {
				const size = Math.min(remaining ?? 1000, 1000);
				const response = (await openObserveApiRequest
					.call(context, {
						pathSegments: ['pipelines', 'history'],
						query: {
							pipeline_id: historyPipelineId,
							...(start === undefined ? {} : { start_time: start }),
							...(end === undefined ? {} : { end_time: end }),
							from: offset,
							size,
							...(getParameter(context, 'sortBy', itemIndex, '').trim()
								? { sort_by: getParameter(context, 'sortBy', itemIndex, '').trim() }
								: {}),
							sort_order: getParameter(context, 'sortOrder', itemIndex, 'desc'),
						},
						itemIndex,
					})
					.catch((error: unknown) => {
						if (isMissingTriggersHistory(error)) {
							return { total: 0, from: offset, size, hits: [] };
						}
						return Promise.reject(error);
					})) as { hits?: unknown[]; total?: number };
				if (
					!Array.isArray(response.hits) ||
					!Number.isSafeInteger(response.total) ||
					(response.total ?? -1) < 0
				)
					throw new OpenObserveValidationError(
						`Pipeline history response is malformed at item ${itemIndex}`,
					);
				return {
					items: response.hits,
					nextCursor:
						response.hits.length === 0 || offset + response.hits.length >= (response.total ?? 0)
							? undefined
							: offset + response.hits.length,
				};
			},
		});
		return items(rows, itemIndex);
	}
	if (operation === 'create') {
		const advanced = requireJsonObject(
			getParameter(context, 'pipelineJson', itemIndex, '{}'),
			'Pipeline JSON',
			itemIndex,
		) as IDataObject;
		const pipelineType = getParameter(context, 'pipelineType', itemIndex, 'realtime');
		if (!advanced.source || typeof advanced.source !== 'object' || Array.isArray(advanced.source))
			throw new OpenObserveValidationError(
				`Pipeline source must be an object at item ${itemIndex}`,
			);
		const source = {
			...(advanced.source as IDataObject),
			source_type: pipelineType,
		};
		const body = validatePipeline(
			{
				...advanced,
				source,
				kind: 'user',
				name: required(context, 'name', itemIndex, 'Name'),
				description: getParameter(context, 'description', itemIndex, ''),
				enabled: getParameter(context, 'enabled', itemIndex, true),
			},
			itemIndex,
		);
		return items(
			[
				await openObserveApiRequest.call(context, {
					method: 'POST',
					pathSegments: ['pipelines'],
					body,
					itemIndex,
				}),
			],
			itemIndex,
		);
	}
	const pipelineId = required(context, 'pipelineId', itemIndex, 'Pipeline ID');
	if (operation === 'get')
		return items(
			[
				await openObserveApiRequest.call(context, {
					pathSegments: ['pipelines', pipelineId],
					itemIndex,
				}),
			],
			itemIndex,
		);
	if (operation === 'update') {
		await requireVisibleUserPipeline(context, pipelineId, itemIndex);
		const current = (await openObserveApiRequest.call(context, {
			pathSegments: ['pipelines', pipelineId],
			itemIndex,
		})) as IDataObject;
		if (current.pipeline_id !== pipelineId || !Number.isInteger(current.version))
			throw new OpenObserveValidationError(
				`Current pipeline identity or version is missing at item ${itemIndex}`,
			);
		if (current.kind === 'evaluation')
			throw new OpenObserveValidationError(
				`System evaluation pipelines cannot be updated at item ${itemIndex}`,
			);
		const advanced = requireJsonObject(
			getParameter(context, 'pipelineJson', itemIndex, '{}'),
			'Pipeline JSON',
			itemIndex,
		) as IDataObject;
		const fields = getParameter<IDataObject>(context, 'updateFields', itemIndex, {});
		const body: IDataObject = {
			...current,
			...advanced,
			pipeline_id: current.pipeline_id,
			version: current.version,
		};
		if (current.kind === undefined) delete body.kind;
		else body.kind = current.kind;
		for (const key of ['name', 'description', 'enabled'])
			if (Object.prototype.hasOwnProperty.call(fields, key)) body[key] = fields[key];
		validatePipeline(body, itemIndex);
		return items(
			[
				await openObserveApiRequest.call(context, {
					method: 'PUT',
					pathSegments: ['pipelines'],
					body,
					itemIndex,
				}),
			],
			itemIndex,
		);
	}
	if (operation === 'enable' || operation === 'disable') {
		await requireVisibleUserPipeline(context, pipelineId, itemIndex);
		const current = (await openObserveApiRequest.call(context, {
			pathSegments: ['pipelines', pipelineId],
			itemIndex,
		})) as IDataObject;
		if (current.kind === 'evaluation')
			throw new OpenObserveValidationError(
				`System evaluation pipelines cannot be changed at item ${itemIndex}`,
			);
		return items(
			[
				await openObserveApiRequest.call(context, {
					method: 'PUT',
					pathSegments: ['pipelines', pipelineId, 'enable'],
					query: { value: operation === 'enable' },
					itemIndex,
				}),
			],
			itemIndex,
		);
	}
	if (operation !== 'delete')
		throw new OpenObserveValidationError(
			`Unsupported Pipeline operation "${operation}" at item ${itemIndex}`,
		);
	if (!getParameter(context, 'confirmDestructive', itemIndex, false))
		throw new OpenObserveValidationError(`Confirm pipeline deletion at item ${itemIndex}`);
	await requireVisibleUserPipeline(context, pipelineId, itemIndex);
	const current = (await openObserveApiRequest.call(context, {
		pathSegments: ['pipelines', pipelineId],
		itemIndex,
	})) as IDataObject;
	if (current.kind === 'evaluation')
		throw new OpenObserveValidationError(
			`System evaluation pipelines cannot be deleted at item ${itemIndex}`,
		);
	return items(
		[
			await openObserveApiRequest.call(context, {
				method: 'DELETE',
				pathSegments: ['pipelines', pipelineId],
				itemIndex,
			}),
		],
		itemIndex,
	);
}
