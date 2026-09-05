import type { INode, JsonObject } from 'n8n-workflow';
import { NodeApiError, NodeOperationError } from 'n8n-workflow';

import { OpenObserveValidationError } from './validation-error';

const STATUS_MESSAGES: Record<number, string> = {
	400: 'OpenObserve rejected the request',
	401: 'OpenObserve authentication failed',
	403: 'OpenObserve denied access to this resource',
	404: 'The OpenObserve resource was not found',
};

export function redactSensitive(value: unknown, secrets: string[] = []): string {
	const seen = new WeakSet<object>();
	let text =
		value instanceof Error
			? value.message
			: typeof value === 'string'
				? value
				: safeStringify(value, seen);
	if (!text) return 'Unknown OpenObserve error';

	for (const secret of secrets) {
		if (secret) text = text.split(secret).join('[REDACTED]');
	}
	return text
		.replace(/(authorization\s*[:=]\s*)(?:basic|bearer)\s+[^\s,}"']+/gi, '$1[REDACTED]')
		.replace(
			/([?&](?:access_token|api_key|apikey|api-token|token|secret|password|key|authorization)=)[^&#\s"',}\]]*/gi,
			'$1[REDACTED]',
		)
		.replace(/(https?:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, '$1[REDACTED]@')
		.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, '[REDACTED_EMAIL]')
		.replace(
			/("?(?:access_token|api_key|apikey|api-token|password|secret|token|authorization)"?\s*:\s*")[^"]*/gi,
			'$1[REDACTED]',
		);
}

function safeStringify(value: unknown, seen: WeakSet<object>): string {
	try {
		return JSON.stringify(value, (_key, nestedValue: unknown) => {
			if (typeof nestedValue === 'bigint') return nestedValue.toString();
			if (nestedValue && typeof nestedValue === 'object') {
				if (seen.has(nestedValue)) return '[Circular]';
				seen.add(nestedValue);
			}
			return nestedValue;
		});
	} catch {
		return Object.prototype.toString.call(value);
	}
}

function statusCodeFrom(error: unknown): number | undefined {
	if (!error || typeof error !== 'object') return undefined;
	const candidate = error as {
		statusCode?: unknown;
		httpCode?: unknown;
		response?: { status?: unknown; statusCode?: unknown };
	};
	const value =
		candidate.statusCode ??
		candidate.httpCode ??
		candidate.response?.statusCode ??
		candidate.response?.status;
	const status = typeof value === 'string' ? Number(value) : value;
	return typeof status === 'number' && Number.isInteger(status) ? status : undefined;
}

export function normalizeOpenObserveError(
	node: INode,
	error: unknown,
	options: { itemIndex?: number; secrets?: string[] } = {},
): NodeApiError | NodeOperationError {
	const status = statusCodeFrom(error);
	const safeDetail = redactSensitive(error, options.secrets);
	if (error instanceof OpenObserveValidationError) {
		return new NodeOperationError(node, safeDetail, {
			itemIndex: options.itemIndex,
		});
	}
	if (status !== undefined) {
		return new NodeApiError(node, { message: safeDetail, statusCode: status } as JsonObject, {
			message: STATUS_MESSAGES[status] ?? `OpenObserve API request failed (${status})`,
			description: safeDetail,
			httpCode: String(status),
			itemIndex: options.itemIndex,
		});
	}

	return new NodeOperationError(node, 'Unable to connect to OpenObserve', {
		description: safeDetail,
		itemIndex: options.itemIndex,
	});
}
