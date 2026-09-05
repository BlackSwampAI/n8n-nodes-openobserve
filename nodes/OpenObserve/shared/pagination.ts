import { OpenObserveValidationError } from './validation-error';

export interface PageResult<T, TCursor> {
	items: T[];
	nextCursor?: TCursor;
}

interface PaginationBase<T, TCursor> {
	initialCursor: TCursor;
	maxPages?: number;
	cursorKey?: (cursor: TCursor) => string;
	fetchPage: (cursor: TCursor, remaining?: number) => Promise<PageResult<T, TCursor>>;
}

export type PaginationOptions<T, TCursor> = PaginationBase<T, TCursor> &
	({ returnAll: true; limit?: never } | { returnAll: false; limit: number });

export async function collectPaginated<T, TCursor>(
	options: PaginationOptions<T, TCursor>,
): Promise<T[]> {
	if (!options.returnAll && (!Number.isSafeInteger(options.limit) || options.limit < 1)) {
		throw new OpenObserveValidationError('Limit must be a positive safe integer');
	}
	const maxPages = options.maxPages ?? 1_000;
	if (!Number.isSafeInteger(maxPages) || maxPages < 1) {
		throw new OpenObserveValidationError('Maximum pages must be a positive safe integer');
	}

	const collected: T[] = [];
	let cursor = options.initialCursor;
	const seenCursors = [cursor];
	const seenCursorKeys = options.cursorKey ? new Set([options.cursorKey(cursor)]) : undefined;
	let pageCount = 0;

	while (true) {
		if (pageCount >= maxPages) {
			throw new OpenObserveValidationError(`Pagination exceeded the maximum of ${maxPages} pages`);
		}
		pageCount += 1;
		const remaining = options.returnAll ? undefined : options.limit - collected.length;
		const page = await options.fetchPage(cursor, remaining);
		if (options.returnAll) collected.push(...page.items);
		else collected.push(...page.items.slice(0, remaining));

		const reachedLimit = !options.returnAll && collected.length >= options.limit;
		if (reachedLimit || page.items.length === 0 || page.nextCursor === undefined) break;
		const alreadySeen = options.cursorKey
			? seenCursorKeys?.has(options.cursorKey(page.nextCursor))
			: seenCursors.some((seenCursor) => Object.is(seenCursor, page.nextCursor));
		if (alreadySeen) {
			throw new OpenObserveValidationError('Pagination did not advance to a new cursor');
		}
		seenCursors.push(page.nextCursor);
		if (options.cursorKey) seenCursorKeys?.add(options.cursorKey(page.nextCursor));
		cursor = page.nextCursor;
	}
	return collected;
}
