import type {
	ICredentialDataDecryptedObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	IHttpRequestOptions,
	ILoadOptionsFunctions,
	IWebhookFunctions,
} from 'n8n-workflow';

import { normalizeOpenObserveError } from './errors';
import type { QueryParameters } from './query';
import type { ApiPathMode } from './url';
import { buildApiUrl, buildApiV2Url } from './url';

export const OPENOBSERVE_CREDENTIAL_TYPE = 'openObserveApi';

export interface OpenObserveRequestOptions {
	apiPathMode?: ApiPathMode;
	method?: IHttpRequestMethods;
	pathSegments?: string[];
	query?: QueryParameters;
	headers?: IHttpRequestOptions['headers'];
	body?: IHttpRequestOptions['body'];
	encoding?: IHttpRequestOptions['encoding'];
	returnFullResponse?: boolean;
	timeout?: number;
	itemIndex?: number;
	sensitiveValues?: string[];
}

export type OpenObserveRequestContext =
	| IExecuteFunctions
	| ILoadOptionsFunctions
	| IHookFunctions
	| IWebhookFunctions;

function credentialString(
	credentials: ICredentialDataDecryptedObject,
	key: 'accountIdentifier' | 'baseUrl' | 'organizationId' | 'secret',
): string {
	const value = credentials[key];
	return typeof value === 'string' ? value : '';
}

export async function openObserveApiRequest<T>(
	this: OpenObserveRequestContext,
	options: OpenObserveRequestOptions,
): Promise<T> {
	const credentials = await this.getCredentials(OPENOBSERVE_CREDENTIAL_TYPE);
	const accountIdentifier = credentialString(credentials, 'accountIdentifier');
	const secret = credentialString(credentials, 'secret');

	try {
		const buildUrl = options.apiPathMode === 'v2' ? buildApiV2Url : buildApiUrl;
		const request: IHttpRequestOptions = {
			url: buildUrl(
				credentialString(credentials, 'baseUrl'),
				credentialString(credentials, 'organizationId'),
				...(options.pathSegments ?? []),
			),
			method: options.method ?? 'GET',
			headers: options.headers,
			body: options.body,
			qs: options.query,
			arrayFormat: 'repeat',
			encoding: options.encoding,
			returnFullResponse: options.returnFullResponse,
			timeout: options.timeout,
			json: options.encoding !== 'arraybuffer',
		};
		return (await this.helpers.httpRequestWithAuthentication.call(
			this as IExecuteFunctions,
			OPENOBSERVE_CREDENTIAL_TYPE,
			request,
		)) as T;
	} catch (error) {
		throw normalizeOpenObserveError(this.getNode(), error, {
			itemIndex: options.itemIndex,
			secrets: [accountIdentifier, secret, ...(options.sensitiveValues ?? [])],
		});
	}
}
