import type {
	IHookFunctions,
	ILoadOptionsFunctions,
	INodeListSearchResult,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
} from 'n8n-workflow';
import { NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';
import { openObserveApiRequest } from '../OpenObserve/shared/transport';
import { normalizeLocatorValue } from '../OpenObserve/shared/locator';
import {
	activateTrigger,
	deactivateTrigger,
	type TriggerState,
	validateWebhookSecret,
} from './lifecycle';

const staticState = (context: IHookFunctions | IWebhookFunctions) =>
	context.getWorkflowStaticData('node') as TriggerState;

// Trigger nodes receive events and cannot be invoked as action tools.
export class OpenObserveTrigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'OpenObserve Trigger',
		name: 'openObserveTrigger',
		icon: { light: 'file:openobserve.svg', dark: 'file:openobserve.dark.svg' },
		group: ['trigger'],
		version: 1,
		description: 'Starts a workflow when a selected OpenObserve alert is triggered',
		subtitle: 'Alert Triggered',
		defaults: { name: 'OpenObserve Trigger' },
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [{ name: 'openObserveApi', required: true }],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'openobserve-alert',
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				noDataExpression: true,
				default: 'alertTriggered',
				options: [{ name: 'Alert Triggered', value: 'alertTriggered' }],
			},
			{
				displayName: 'Alert Folder',
				name: 'alertFolder',
				type: 'resourceLocator',
				required: true,
				default: { mode: 'list', value: 'default' },
				modes: [
					{
						displayName: 'From List',
						name: 'list',
						type: 'list',
						typeOptions: { searchListMethod: 'searchAlertFolders', searchable: true },
					},
					{ displayName: 'By ID', name: 'id', type: 'string' },
				],
			},
			{
				displayName: 'Alert Names or IDs',
				name: 'alertIds',
				type: 'multiOptions',
				typeOptions: { loadOptionsMethod: 'getAlerts' },
				required: true,
				default: [],
				description:
					'Choose from the list, or specify IDs using an <a href="https://docs.n8n.io/code/expressions/">expression</a>',
			},
		],
	};

	methods = {
		listSearch: {
			async searchAlertFolders(
				this: ILoadOptionsFunctions,
				filter?: string,
			): Promise<INodeListSearchResult> {
				const response = (await openObserveApiRequest.call(this, {
					apiPathMode: 'v2',
					pathSegments: ['folders', 'alerts'],
				})) as { list?: Array<{ folderId?: string; name?: string }> };
				const needle = (filter ?? '').toLowerCase();
				const results = [
					{ name: 'Default', value: 'default' },
					...(response.list ?? [])
						.filter(
							(entry) =>
								entry.folderId &&
								entry.folderId !== 'default' &&
								entry.name?.toLowerCase().includes(needle),
						)
						.map((entry) => ({ name: entry.name as string, value: entry.folderId as string })),
				];
				return { results: results.filter((entry) => entry.name.toLowerCase().includes(needle)) };
			},
		},
		loadOptions: {
			async getAlerts(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const folder = normalizeLocatorValue(
					this.getNodeParameter('alertFolder', 'default'),
					'Alert folder',
					0,
					{ fallback: 'default' },
				);
				const response = (await openObserveApiRequest.call(this, {
					apiPathMode: 'v2',
					pathSegments: ['alerts'],
					query: { folder, page_size: 100, page_idx: 0 },
				})) as { list?: Array<{ id?: string; alert_id?: string; name?: string }> };
				return (response.list ?? []).flatMap((entry) => {
					const id = entry.id ?? entry.alert_id;
					return id ? [{ name: entry.name || id, value: id }] : [];
				});
			},
		},
	};

	webhookMethods = {
		default: {
			checkExists: async function (this: IHookFunctions) {
				const state = staticState(this);
				if (
					state.version !== 1 ||
					!state.secret ||
					!state.templateName ||
					!state.destinationName ||
					!state.webhookUrl
				)
					return false;
				const webhookUrl = this.getNodeWebhookUrl('default');
				if (!webhookUrl) return false;
				await activateTrigger(this, state, {
					webhookUrl,
					folderId: normalizeLocatorValue(
						this.getNodeParameter('alertFolder', 'default'),
						'Alert folder',
						0,
						{ fallback: 'default' },
					),
					alertIds: this.getNodeParameter('alertIds', []) as string[],
				});
				return true;
			},
			create: async function (this: IHookFunctions) {
				const webhookUrl = this.getNodeWebhookUrl('default');
				if (!webhookUrl)
					throw new NodeOperationError(this.getNode(), 'Production webhook URL is unavailable');
				const alertIds = this.getNodeParameter('alertIds', []) as string[];
				await activateTrigger(this, staticState(this), {
					webhookUrl,
					folderId: normalizeLocatorValue(
						this.getNodeParameter('alertFolder', 'default'),
						'Alert folder',
						0,
						{ fallback: 'default' },
					),
					alertIds,
				});
				return true;
			},
			delete: async function (this: IHookFunctions) {
				await deactivateTrigger(this, staticState(this));
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions) {
		const request = this.getRequestObject();
		let occurrences = 0;
		for (let index = 0; index < request.rawHeaders.length; index += 2)
			if (request.rawHeaders[index]?.toLowerCase() === 'x-n8n-openobserve-secret') occurrences += 1;
		const supplied = this.getHeaderData()['x-n8n-openobserve-secret'];
		if (occurrences !== 1 || !validateWebhookSecret(staticState(this).secret ?? '', supplied)) {
			this.getResponseObject().status(401).send('Unauthorized').end();
			return { noWebhookResponse: true };
		}
		const body = this.getBodyData();
		if (!body || typeof body !== 'object' || Array.isArray(body)) {
			this.getResponseObject().status(400).send('Invalid JSON body').end();
			return { noWebhookResponse: true };
		}
		return { workflowData: [[{ json: body }]] };
	}
}
