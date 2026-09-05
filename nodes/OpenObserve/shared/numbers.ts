import { OpenObserveValidationError } from './validation-error';

export function requireNonNegativeSafeInteger(
	value: unknown,
	label: string,
	itemIndex: number,
): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
		throw new OpenObserveValidationError(
			`${label} must be a non-negative safe integer at item ${itemIndex}`,
		);
	}
	return value;
}

export function requirePositiveSafeInteger(
	value: unknown,
	label: string,
	itemIndex: number,
): number {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
		throw new OpenObserveValidationError(
			`${label} must be a positive safe integer at item ${itemIndex}`,
		);
	}
	return value;
}
