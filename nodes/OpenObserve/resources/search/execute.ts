import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { requireJsonObject } from '../../shared/json';
import { normalizeLocatorValue } from '../../shared/locator';
import { collectPaginated } from '../../shared/pagination';
import { requireNonNegativeSafeInteger, requirePositiveSafeInteger } from '../../shared/numbers';
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
) => normalizeLocatorValue(context.getNodeParameter(name, itemIndex, ''), label, itemIndex);
const getTimeRange = (context: IExecuteFunctions, itemIndex: number) => {
	const start = toOpenObserveMicroseconds(
		getRequiredParameter(context, 'startTime', itemIndex, 'Start time'),
		{
			itemIndex,
		},
	);
	const end = toOpenObserveMicroseconds(
		getRequiredParameter(context, 'endTime', itemIndex, 'End time'),
		{ itemIndex },
	);
	if (start > end)
		throw new OpenObserveValidationError(
			`Start time must not be after end time at item ${itemIndex}`,
		);
	return { start, end };
};
const toItems = (values: unknown[], itemIndex: number): INodeExecutionData[] =>
	values.map((value) => ({
		json: (value && typeof value === 'object' ? value : { value }) as IDataObject,
		pairedItem: { item: itemIndex },
	}));

export async function executeSearch(
	context: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const limit = requirePositiveSafeInteger(
		getParameter(context, 'limit', itemIndex, 50),
		'Limit',
		itemIndex,
	);
	const timeout = requireNonNegativeSafeInteger(
		getParameter(context, 'timeout', itemIndex, 0),
		'Timeout',
		itemIndex,
	);
	const type = getParameter(context, 'streamType', itemIndex, 'logs');
	if (operation === 'query') {
		const { start, end } = getTimeRange(context, itemIndex);
		const offset = requireNonNegativeSafeInteger(
			getParameter(context, 'offset', itemIndex, 0),
			'Offset',
			itemIndex,
		);
		const searchType = getParameter(context, 'searchType', itemIndex, '');
		const outputMode = getParameter<string>(context, 'outputMode', itemIndex, 'rows');
		const outputFormat = outputMode === 'csv' || outputMode === 'md_table' ? outputMode : 'json';
		const sql = getRequiredParameter(context, 'sql', itemIndex, 'SQL');
		const fetchPage = async (from: number, size: number) =>
			(await openObserveApiRequest.call(context, {
				method: 'POST',
				pathSegments: ['_search'],
				query: { type },
				body: {
					query: { sql, start_time: start, end_time: end, from, size },
					...(searchType ? { search_type: searchType } : {}),
					...(timeout ? { timeout } : {}),
					...(outputFormat === 'json' ? {} : { agent_options: { output_format: outputFormat } }),
				},
				itemIndex,
			})) as IDataObject;
		if (outputMode !== 'rows') return toItems([await fetchPage(offset, limit)], itemIndex);
		if (getParameter(context, 'returnAll', itemIndex, false)) {
			return toItems(
				await collectPaginated<unknown, number>({
					returnAll: true,
					initialCursor: offset,
					fetchPage: async (from) => {
						const page = await fetchPage(from, 100);
						const hits = Array.isArray(page.hits) ? page.hits : [];
						return {
							items: hits,
							nextCursor:
								from + hits.length < Number(page.total ?? 0) ? from + hits.length : undefined,
						};
					},
				}),
				itemIndex,
			);
		}
		const response = await fetchPage(offset, limit);
		return toItems(Array.isArray(response.hits) ? response.hits : [], itemIndex);
	}
	const stream = getRequiredParameter(context, 'streamName', itemIndex, 'Stream name');
	if (operation === 'getFieldValues') {
		const { start, end } = getTimeRange(context, itemIndex);
		const filter = getParameter(context, 'filter', itemIndex, '');
		const keyword = getParameter(context, 'keyword', itemIndex, '');
		const offset = requireNonNegativeSafeInteger(
			getParameter(context, 'offset', itemIndex, 0),
			'Offset',
			itemIndex,
		);
		const response = (await openObserveApiRequest.call(context, {
			pathSegments: [stream, '_values'],
			query: {
				type,
				fields: getRequiredParameter(context, 'fields', itemIndex, 'Fields'),
				from: offset,
				size: limit,
				start_time: start,
				end_time: end,
				...(filter ? { filter } : {}),
				...(keyword ? { keyword } : {}),
				...(timeout ? { timeout } : {}),
			},
			itemIndex,
		})) as IDataObject;
		return toItems([response], itemIndex);
	}
	if (operation !== 'searchAround')
		throw new OpenObserveValidationError(
			`Unsupported Search operation "${operation}" at item ${itemIndex}`,
		);
	const aroundRecord = requireJsonObject(
		context.getNodeParameter('aroundRecordJson', itemIndex, ''),
		'Around Record JSON',
		itemIndex,
	);
	requirePositiveSafeInteger(aroundRecord._timestamp, 'Around Record JSON _timestamp', itemIndex);
	const response = await openObserveApiRequest.call(context, {
		method: 'POST',
		pathSegments: [stream, '_around'],
		query: { size: limit, ...(timeout ? { timeout } : {}) },
		body: aroundRecord,
		itemIndex,
	});
	return toItems([response], itemIndex);
}
