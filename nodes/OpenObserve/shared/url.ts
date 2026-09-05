import { OpenObserveValidationError } from './validation-error';

const SUPPORTED_PROTOCOLS = new Set(['http:', 'https:']);

export type ApiPathMode = 'unversioned' | 'v2';

export function normalizeBaseUrl(value: unknown): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new OpenObserveValidationError('Base URL is required');
	}

	const trimmed = value.trim();
	if (!URL.canParse(trimmed)) {
		throw new OpenObserveValidationError('Base URL must be a valid HTTP or HTTPS URL');
	}
	const parsed = new URL(trimmed);

	if (!SUPPORTED_PROTOCOLS.has(parsed.protocol)) {
		throw new OpenObserveValidationError('Base URL must use HTTP or HTTPS');
	}
	if (parsed.username || parsed.password) {
		throw new OpenObserveValidationError('Base URL must not contain a username or password');
	}
	if (parsed.search)
		throw new OpenObserveValidationError('Base URL must not contain query parameters');
	if (parsed.hash) throw new OpenObserveValidationError('Base URL must not contain a fragment');

	parsed.pathname = parsed.pathname.replace(/\/+$/, '');
	return parsed.toString().replace(/\/$/, '');
}

export function requireOrganizationId(value: unknown): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new OpenObserveValidationError('Organization ID is required');
	}
	return value.trim();
}

export function encodePathSegment(value: unknown, label = 'Path segment'): string {
	if (typeof value !== 'string' || value.trim() === '') {
		throw new OpenObserveValidationError(`${label} is required`);
	}
	const trimmed = value.trim();
	if (trimmed === '.' || trimmed === '..') {
		throw new OpenObserveValidationError(`${label} must not be a dot segment`);
	}
	return encodeURIComponent(trimmed);
}

export function buildApiPathForMode(
	mode: ApiPathMode,
	organizationId: unknown,
	...segments: unknown[]
): string {
	const organization = encodePathSegment(requireOrganizationId(organizationId), 'Organization ID');
	const encodedSegments = segments.map((segment) => encodePathSegment(segment));
	const prefix = mode === 'v2' ? '/api/v2' : '/api';
	return `${prefix}/${organization}${encodedSegments.length ? `/${encodedSegments.join('/')}` : ''}`;
}

export function buildApiPath(organizationId: unknown, ...segments: unknown[]): string {
	return buildApiPathForMode('unversioned', organizationId, ...segments);
}

export function buildApiV2Path(organizationId: unknown, ...segments: unknown[]): string {
	return buildApiPathForMode('v2', organizationId, ...segments);
}

export function buildApiUrl(
	baseUrl: unknown,
	organizationId: unknown,
	...segments: unknown[]
): string {
	return `${normalizeBaseUrl(baseUrl)}${buildApiPath(organizationId, ...segments)}`;
}

export function buildApiV2Url(
	baseUrl: unknown,
	organizationId: unknown,
	...segments: unknown[]
): string {
	return `${normalizeBaseUrl(baseUrl)}${buildApiV2Path(organizationId, ...segments)}`;
}
