import { OpenObserveValidationError } from './validation-error';

export type JsonRecord = Record<string, unknown>;

function invalidJson(label: string, itemIndex?: number): never {
	throw new OpenObserveValidationError(
		`${label} must be valid JSON${itemIndex === undefined ? '' : ` at item ${itemIndex}`}`,
	);
}

export function parseJsonValue(value: unknown, label: string, itemIndex?: number): unknown {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value) as unknown;
	} catch {
		return invalidJson(label, itemIndex);
	}
}

export function requireJsonObject(value: unknown, label: string, itemIndex?: number): JsonRecord {
	const parsed = parseJsonValue(value, label, itemIndex);
	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new OpenObserveValidationError(
			`${label} must be a JSON object${itemIndex === undefined ? '' : ` at item ${itemIndex}`}`,
		);
	}
	return parsed as JsonRecord;
}

export function requireJsonArray(value: unknown, label: string, itemIndex?: number): unknown[] {
	const parsed = parseJsonValue(value, label, itemIndex);
	if (!Array.isArray(parsed)) {
		throw new OpenObserveValidationError(
			`${label} must be a JSON array${itemIndex === undefined ? '' : ` at item ${itemIndex}`}`,
		);
	}
	return parsed;
}
