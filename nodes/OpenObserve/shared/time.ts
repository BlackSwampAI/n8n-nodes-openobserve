import { OpenObserveValidationError } from './validation-error';

export type NumericTimeUnit = 'microseconds' | 'milliseconds' | 'seconds';

export interface TimeConversionOptions {
	numericUnit?: NumericTimeUnit;
	itemIndex?: number;
}

function invalidTime(message: string, itemIndex?: number): Error {
	return new OpenObserveValidationError(
		itemIndex === undefined ? message : `${message} (item ${itemIndex})`,
	);
}

export function toOpenObserveMicroseconds(
	value: Date | number | string,
	options: TimeConversionOptions = {},
): number {
	const { numericUnit = 'milliseconds', itemIndex } = options;
	let milliseconds = Number.NaN;

	if (value instanceof Date) {
		milliseconds = value.getTime();
	} else if (typeof value === 'string') {
		if (value.trim() === '') throw invalidTime('Date/time value is required', itemIndex);
		milliseconds = Date.parse(value);
	} else if (typeof value === 'number') {
		if (!Number.isFinite(value)) throw invalidTime('Numeric date/time must be finite', itemIndex);
		const multiplier =
			numericUnit === 'seconds' ? 1_000_000 : numericUnit === 'milliseconds' ? 1_000 : 1;
		const result = value * multiplier;
		if (!Number.isSafeInteger(result) || result < 0) {
			throw invalidTime('Date/time is outside the supported microsecond range', itemIndex);
		}
		return result;
	}

	if (!Number.isFinite(milliseconds)) throw invalidTime('Date/time value is invalid', itemIndex);
	const microseconds = milliseconds * 1_000;
	if (!Number.isSafeInteger(microseconds) || microseconds < 0) {
		throw invalidTime('Date/time is outside the supported microsecond range', itemIndex);
	}
	return microseconds;
}
