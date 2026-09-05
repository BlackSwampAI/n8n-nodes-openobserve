export type QueryPrimitive = boolean | number | string;
export type QueryValue = QueryPrimitive | QueryPrimitive[] | null | undefined;
export type QueryParameters = Record<string, QueryValue>;

export function serializeQuery(parameters: QueryParameters): string {
	const query = new URLSearchParams();
	for (const [key, rawValue] of Object.entries(parameters)) {
		if (rawValue === undefined || rawValue === null) continue;
		const values = Array.isArray(rawValue) ? rawValue : [rawValue];
		for (const value of values) query.append(key, String(value));
	}
	return query.toString();
}

export function appendQuery(url: string, parameters?: QueryParameters): string {
	if (!parameters) return url;
	const query = serializeQuery(parameters);
	return query ? `${url}${url.includes('?') ? '&' : '?'}${query}` : url;
}
