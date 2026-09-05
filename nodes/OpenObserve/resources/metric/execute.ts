import type { IDataObject, IExecuteFunctions, INodeExecutionData } from 'n8n-workflow';
import { requirePositiveSafeInteger } from '../../shared/numbers';
import { openObserveApiRequest } from '../../shared/transport';
import { OpenObserveValidationError } from '../../shared/validation-error';

interface PromEnvelope {
	status?: string;
	data?: unknown;
	error?: string;
}
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
const prometheusTime = (value: string, label: string, itemIndex: number) => {
	const milliseconds = Date.parse(value);
	if (!Number.isFinite(milliseconds))
		throw new OpenObserveValidationError(`${label} is invalid at item ${itemIndex}`);
	return new Date(milliseconds).toISOString();
};
const toItems = (value: unknown, itemIndex: number): INodeExecutionData[] =>
	(Array.isArray(value) ? value : [value]).map((entry) => ({
		json: (entry && typeof entry === 'object' ? entry : { value: entry }) as IDataObject,
		pairedItem: { item: itemIndex },
	}));
const normalizePrometheusResponse = (response: PromEnvelope, raw: boolean, itemIndex: number) => {
	if (raw) return toItems(response, itemIndex);
	if (response.status === 'error') {
		throw new OpenObserveValidationError(
			`Prometheus query failed at item ${itemIndex}: ${response.error || 'unknown error'}`,
		);
	}
	if (
		response.data &&
		typeof response.data === 'object' &&
		!Array.isArray(response.data) &&
		'result' in response.data
	) {
		const data = response.data as { result?: unknown; resultType?: unknown };
		if (Array.isArray(data.result) && ['vector', 'matrix'].includes(String(data.resultType))) {
			return toItems(
				data.result.map((entry) =>
					entry && typeof entry === 'object'
						? { resultType: data.resultType, ...entry }
						: { resultType: data.resultType, value: entry },
				),
				itemIndex,
			);
		}
		return toItems({ resultType: data.resultType, value: data.result }, itemIndex);
	}
	return toItems(response.data ?? [], itemIndex);
};
const getSelectors = (context: IExecuteFunctions, itemIndex: number) => {
	const values = getRequiredParameter(context, 'selectors', itemIndex, 'Series selectors')
		.split(/\r?\n/)
		.map((value) => value.trim())
		.filter(Boolean);
	return values;
};

function isPositivePrometheusStep(value: string): boolean {
	if (/^\d+(?:\.\d+)?$/.test(value)) return Number(value) > 0;
	const duration =
		/^(?:(\d+)y)?(?:(\d+)w)?(?:(\d+)d)?(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?(?:(\d+)ms)?$/.exec(value);
	return duration !== null && duration.slice(1).some((component) => Number(component ?? 0) > 0);
}

export async function executeMetric(
	context: IExecuteFunctions,
	operation: string,
	itemIndex: number,
): Promise<INodeExecutionData[]> {
	const base = ['prometheus', 'api', 'v1'];
	const raw = getParameter(context, 'rawResponse', itemIndex, false);
	let path: string[];
	const query: Record<string, string | string[] | number> = {};
	if (operation === 'instantQuery' || operation === 'rangeQuery') {
		query.query = getRequiredParameter(context, 'promql', itemIndex, 'PromQL');
		const timeout = getParameter(context, 'queryTimeout', itemIndex, '');
		if (timeout) query.timeout = timeout;
		if (operation === 'instantQuery') {
			path = [...base, 'query'];
			const time = getParameter(context, 'queryTime', itemIndex, '');
			if (time) query.time = prometheusTime(time, 'Time', itemIndex);
		} else {
			path = [...base, 'query_range'];
			query.start = prometheusTime(
				getRequiredParameter(context, 'startTime', itemIndex, 'Start'),
				'Start',
				itemIndex,
			);
			query.end = prometheusTime(
				getRequiredParameter(context, 'endTime', itemIndex, 'End'),
				'End',
				itemIndex,
			);
			if (Date.parse(String(query.start)) > Date.parse(String(query.end)))
				throw new OpenObserveValidationError(
					`Start time must not be after end time at item ${itemIndex}`,
				);
			const step = getRequiredParameter(context, 'step', itemIndex, 'Step');
			if (!isPositivePrometheusStep(step))
				throw new OpenObserveValidationError(`Step is invalid at item ${itemIndex}`);
			query.step = step;
		}
	} else if (operation === 'getMetadata') {
		path = [...base, 'metadata'];
		query.limit = requirePositiveSafeInteger(
			getParameter(context, 'limit', itemIndex, 50),
			'Limit',
			itemIndex,
		);
		const metric = getParameter(context, 'metricName', itemIndex, '');
		if (metric) query.metric = metric;
	} else if (['getLabels', 'getLabelValues', 'findSeries'].includes(operation)) {
		path =
			operation === 'getLabels'
				? [...base, 'labels']
				: operation === 'findSeries'
					? [...base, 'series']
					: [
							...base,
							'label',
							getRequiredParameter(context, 'labelName', itemIndex, 'Label name'),
							'values',
						];
		query['match[]'] = getSelectors(context, itemIndex);
		query.start = prometheusTime(
			getRequiredParameter(context, 'startTime', itemIndex, 'Start'),
			'Start',
			itemIndex,
		);
		query.end = prometheusTime(
			getRequiredParameter(context, 'endTime', itemIndex, 'End'),
			'End',
			itemIndex,
		);
		if (Date.parse(String(query.start)) > Date.parse(String(query.end)))
			throw new OpenObserveValidationError(
				`Start time must not be after end time at item ${itemIndex}`,
			);
	} else
		throw new OpenObserveValidationError(
			`Unsupported Metric operation "${operation}" at item ${itemIndex}`,
		);
	const response = (await openObserveApiRequest.call(context, {
		pathSegments: path,
		query,
		itemIndex,
	})) as PromEnvelope;
	return normalizePrometheusResponse(response, raw, itemIndex);
}
