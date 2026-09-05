import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { requireNonNegativeSafeInteger, requirePositiveSafeInteger } from '../../shared/numbers';
import { collectPaginated } from '../../shared/pagination';
import { toOpenObserveMicroseconds } from '../../shared/time';
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
const getTimeRange = (context: IExecuteFunctions, itemIndex: number) => {
	const start = toOpenObserveMicroseconds(
		getRequiredParameter(context, 'startTime', itemIndex, 'Start'),
		{ itemIndex },
	);
	const end = toOpenObserveMicroseconds(
		getRequiredParameter(context, 'endTime', itemIndex, 'End'),
		{ itemIndex },
	);
	if (start > end)
		throw new OpenObserveValidationError(
			`Start time must not be after end time at item ${itemIndex}`,
		);
	return { start_time: start, end_time: end };
};
const toItems = (values: unknown[], itemIndex: number): INodeExecutionData[] => {
	return values.map((value) => ({
		json: (value && typeof value === 'object' ? value : { value }) as IDataObject,
		pairedItem: { item: itemIndex },
	}));
};
export async function executeTrace(
	context: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const stream = getRequiredParameter(context, 'streamName', itemIndex, 'Trace stream');
	const time = getTimeRange(context, itemIndex);
	const timeout = requireNonNegativeSafeInteger(
		getParameter(context, 'timeout', itemIndex, 0),
		'Timeout',
		itemIndex,
	);
	if (operation === 'getLatest') {
		const filter = getParameter(context, 'filter', itemIndex, '');
		const offset = requireNonNegativeSafeInteger(
			getParameter(context, 'offset', itemIndex, 0),
			'Offset',
			itemIndex,
		);
		const returnAll = getParameter(context, 'returnAll', itemIndex, false);
		const limit = returnAll
			? undefined
			: requirePositiveSafeInteger(
					getParameter(context, 'limit', itemIndex, 50),
					'Limit',
					itemIndex,
				);
		const fetchPage = async (from: number, remaining?: number) => {
			const size = Math.min(remaining ?? 100, 100);
			const response = (await openObserveApiRequest.call(context, {
				pathSegments: [stream, 'traces', 'latest'],
				query: {
					...time,
					from,
					size,
					sort_by: getParameter(context, 'sortBy', itemIndex, 'start_time'),
					sort_order: getParameter(context, 'sortOrder', itemIndex, 'desc'),
					...(filter ? { filter } : {}),
					...(timeout ? { timeout } : {}),
				},
				itemIndex,
			})) as { hits?: unknown[]; total?: number };
			const hits = Array.isArray(response.hits) ? response.hits : [];
			return {
				items: hits,
				nextCursor:
					from + hits.length < Number(response.total ?? 0) ? from + hits.length : undefined,
			};
		};
		const rows = returnAll
			? await collectPaginated<unknown, number>({
					returnAll: true,
					initialCursor: offset,
					fetchPage,
				})
			: await collectPaginated<unknown, number>({
					returnAll: false,
					limit: limit as number,
					initialCursor: offset,
					fetchPage,
				});
		return toItems(rows, itemIndex);
	}
	if (operation !== 'getDag')
		throw new OpenObserveValidationError(
			`Unsupported Trace operation "${operation}" at item ${itemIndex}`,
		);
	const response = await openObserveApiRequest.call(context, {
		pathSegments: [
			stream,
			'traces',
			getRequiredParameter(context, 'traceId', itemIndex, 'Trace ID'),
			'dag',
		],
		query: { ...time, ...(timeout ? { timeout } : {}) },
		itemIndex,
	});
	return toItems([response], itemIndex);
}
