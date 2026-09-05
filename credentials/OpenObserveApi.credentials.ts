import type {
	IAuthenticate,
	ICredentialDataDecryptedObject,
	ICredentialTestRequest,
	ICredentialType,
	IHttpRequestOptions,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

import { createBasicAuthOptions } from '../nodes/OpenObserve/shared/auth';
import {
	buildApiPath,
	normalizeBaseUrl,
	requireOrganizationId,
} from '../nodes/OpenObserve/shared/url';

const CREDENTIAL_TEST_PATH = '/api/__n8n_openobserve_credential_test__/streams';

function credentialString(
	credentials: ICredentialDataDecryptedObject,
	key: 'accountIdentifier' | 'baseUrl' | 'organizationId' | 'secret',
): string {
	const value = credentials[key];
	return typeof value === 'string' ? value : '';
}

export class OpenObserveApi implements ICredentialType {
	name = 'openObserveApi';

	displayName = 'OpenObserve API';

	icon: Icon = {
		light: 'file:../nodes/OpenObserve/openobserve.svg',
		dark: 'file:../nodes/OpenObserve/openobserve.dark.svg',
	};

	documentationUrl =
		'https://github.com/BlackSwampAI/n8n-nodes-openobserve?tab=readme-ov-file#credentials';

	properties: INodeProperties[] = [
		{
			displayName: 'Base URL',
			name: 'baseUrl',
			type: 'string',
			required: true,
			default: '',
			placeholder: 'https://api.openobserve.ai',
			description:
				'OpenObserve API origin, including any reverse-proxy path but not an /api organization path. For example: https://api.openobserve.ai or http://127.0.0.1:5080',
		},
		{
			displayName: 'Organization ID',
			name: 'organizationId',
			type: 'string',
			required: true,
			default: '',
			description: 'Organization identifier shown in OpenObserve',
		},
		{
			displayName: 'Email / Account Identifier',
			name: 'accountIdentifier',
			type: 'string',
			required: true,
			default: '',
			description:
				'User email or self-hosted service-account email used as the Basic auth username',
		},
		{
			displayName: 'Secret',
			name: 'secret',
			type: 'string',
			required: true,
			typeOptions: { password: true },
			default: '',
			description:
				'User password or self-hosted service-account token used as the Basic auth password',
		},
	];

	authenticate: IAuthenticate = async (
		credentials: ICredentialDataDecryptedObject,
		requestOptions: IHttpRequestOptions,
	): Promise<IHttpRequestOptions> => {
		requestOptions.baseURL = normalizeBaseUrl(credentialString(credentials, 'baseUrl'));
		const organizationId = requireOrganizationId(credentialString(credentials, 'organizationId'));
		if (requestOptions.url === CREDENTIAL_TEST_PATH) {
			requestOptions.url = buildApiPath(organizationId, 'streams');
		}
		Object.assign(
			requestOptions,
			createBasicAuthOptions(
				credentialString(credentials, 'accountIdentifier'),
				credentialString(credentials, 'secret'),
			),
		);
		return requestOptions;
	};

	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://openobserve.invalid',
			url: CREDENTIAL_TEST_PATH,
			method: 'GET',
			qs: { type: 'logs', limit: 1 },
		},
	};
}
