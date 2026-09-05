import { OpenObserveValidationError } from './validation-error';

export interface LocatorValueOptions {
	required?: boolean;
	fallback?: string;
}

export function normalizeLocatorValue(
	rawValue: unknown,
	label: string,
	itemIndex: number,
	options: LocatorValueOptions = {},
): string {
	const candidate =
		rawValue === null || rawValue === undefined
			? ''
			: typeof rawValue === 'string'
				? rawValue
				: rawValue !== null &&
					  !Array.isArray(rawValue) &&
					  typeof rawValue === 'object' &&
					  'value' in rawValue &&
					  typeof rawValue.value === 'string'
					? rawValue.value
					: undefined;
	if (candidate === undefined) {
		throw new OpenObserveValidationError(
			`${label} must be selected from the list or provided as text at item ${itemIndex}`,
		);
	}
	const value = candidate.trim() || options.fallback?.trim() || '';
	if (options.required !== false && !value) {
		throw new OpenObserveValidationError(`${label} is required at item ${itemIndex}`);
	}
	return value;
}
