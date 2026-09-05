import type { IHttpRequestOptions } from 'n8n-workflow';

import { OpenObserveValidationError } from './validation-error';

export function createBasicAuthOptions(
	accountIdentifier: unknown,
	secret: unknown,
): Pick<IHttpRequestOptions, 'auth'> {
	if (typeof accountIdentifier !== 'string' || accountIdentifier.trim() === '') {
		throw new OpenObserveValidationError('Email or account identifier is required');
	}
	if (typeof secret !== 'string' || secret === '') {
		throw new OpenObserveValidationError('Secret is required');
	}

	return {
		auth: {
			username: accountIdentifier.trim(),
			password: secret,
			sendImmediately: true,
		},
	};
}
