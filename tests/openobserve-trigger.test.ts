import type { IHookFunctions, ILoadOptionsFunctions, INode, IWebhookFunctions } from 'n8n-workflow';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import triggerMetadata from '../nodes/OpenObserveTrigger/OpenObserveTrigger.node.json';
const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));
vi.mock('../nodes/OpenObserve/shared/transport', () => ({ openObserveApiRequest: requestMock }));
import { OpenObserveTrigger } from '../nodes/OpenObserveTrigger/OpenObserveTrigger.node';
import {
	activateTrigger,
	deactivateTrigger,
	generateWebhookSecret,
	ownershipNames,
	type TriggerState,
	validateWebhookSecret,
} from '../nodes/OpenObserveTrigger/lifecycle';

const node: INode = {
	id: 'node-1',
	name: 'Trigger',
	type: 'openObserveTrigger',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};
function hook(state: TriggerState = {}): IHookFunctions {
	return {
		getNode: () => node,
		getWorkflow: () => ({ id: 'workflow-1' }),
		getWorkflowStaticData: () => state,
		getNodeParameter: () => undefined,
	} as unknown as IHookFunctions;
}
const notFound = () => ({ httpCode: '404' });
const ownedTemplateBody = JSON.stringify({
	event: 'alert_triggered',
	organization: '{org_name}',
	streamType: '{stream_type}',
	streamName: '{stream_name}',
	alertName: '{alert_name}',
	alertType: '{alert_type}',
	triggerTime: '{alert_trigger_time}',
	count: '{alert_count}',
	aggregationValue: '{alert_agg_value}',
	threshold: '{alert_threshold}',
	operator: '{alert_operator}',
	alertUrl: '{alert_url}',
});

describe('OpenObserve Trigger identity and webhook', () => {
	it('creates stable collision-resistant names and high-entropy independent secrets', () => {
		expect(ownershipNames('w', 'n')).toEqual(ownershipNames('w', 'n'));
		expect(ownershipNames('w', 'n')).not.toEqual(ownershipNames('w', 'other'));
		const first = generateWebhookSecret();
		const second = generateWebhookSecret();
		expect(first).toHaveLength(43);
		expect(first).not.toBe(second);
		expect(validateWebhookSecret(first, first)).toBe(true);
		expect(validateWebhookSecret(first, `${first}x`)).toBe(false);
		expect(validateWebhookSecret(first, undefined)).toBe(false);
	});
	it('registers one alert event, credential, webhook, and package-compatible metadata', () => {
		const description = new OpenObserveTrigger().description;
		expect(description.displayName).toBe('OpenObserve Trigger');
		expect(description.credentials).toEqual([{ name: 'openObserveApi', required: true }]);
		expect(description.webhooks).toHaveLength(1);
		expect(description.properties[0].options).toEqual([
			{ name: 'Alert Triggered', value: 'alertTriggered' },
		]);
		expect(triggerMetadata.node).toBe('@blackswampai/n8n-nodes-openobserve.openObserveTrigger');
		expect(triggerMetadata.resources.primaryDocumentation[0].url).toBe(
			'https://github.com/BlackSwampAI/n8n-nodes-openobserve',
		);
	});
	it('rejects missing, wrong, and duplicate headers before emitting, and accepts object JSON', async () => {
		const trigger = new OpenObserveTrigger();
		const state = { secret: 'correct' };
		const end = vi.fn();
		const send = vi.fn(() => ({ end }));
		const status = vi.fn(() => ({ send }));
		const invoke = (rawHeaders: string[], header: unknown, body: unknown) =>
			trigger.webhook.call({
				getWorkflowStaticData: () => state,
				getRequestObject: () => ({ rawHeaders }),
				getHeaderData: () => ({ 'x-n8n-openobserve-secret': header }),
				getBodyData: () => body,
				getResponseObject: () => ({ status }),
			} as unknown as IWebhookFunctions);
		for (const args of [
			[[], undefined],
			[['X-N8N-OpenObserve-Secret', 'wrong'], 'wrong'],
			[['X-N8N-OpenObserve-Secret', 'correct', 'x-n8n-openobserve-secret', 'correct'], 'correct'],
		] as const)
			expect(await invoke([...args[0]], args[1], { alert: 'a' })).toEqual({
				noWebhookResponse: true,
			});
		const accepted = await invoke(['X-N8N-OpenObserve-Secret', 'correct'], 'correct', {
			alert: 'a',
		});
		expect(accepted).toEqual({ workflowData: [[{ json: { alert: 'a' } }]] });
		expect(JSON.stringify(accepted)).not.toContain('correct');
		expect(
			await invoke(
				['X-Unrelated', 'X-N8N-OpenObserve-Secret', 'X-N8N-OpenObserve-Secret', 'correct'],
				'correct',
				{ alert: 'a' },
			),
		).toHaveProperty('workflowData');
		expect(await invoke(['X-N8N-OpenObserve-Secret', 'correct'], 'correct', [])).toEqual({
			noWebhookResponse: true,
		});
		expect(status).toHaveBeenCalledWith(401);
		expect(status).toHaveBeenCalledWith(400);
		expect(end).toHaveBeenCalled();
	});
});

describe('OpenObserve Trigger lifecycle', () => {
	beforeEach(() => requestMock.mockReset());
	it('creates owned artifacts, unions selected alerts, persists state, and is idempotent on restart', async () => {
		const state: TriggerState = {};
		const context = hook(state);
		requestMock
			.mockRejectedValueOnce(notFound())
			.mockResolvedValueOnce({ code: 200 })
			.mockRejectedValueOnce(notFound())
			.mockResolvedValueOnce({ code: 200 })
			.mockResolvedValueOnce({
				id: 'a',
				name: 'alert',
				destinations: ['existing'],
				description: 'keep',
			})
			.mockResolvedValueOnce({ code: 200 });
		await activateTrigger(context, state, {
			webhookUrl: 'https://n8n.test/webhook',
			folderId: 'default',
			alertIds: ['a'],
		});
		const put = requestMock.mock.calls.find((call) => call[0].method === 'PUT')?.[0];
		expect(put.body).toMatchObject({
			description: 'keep',
			destinations: ['existing', state.destinationName],
		});
		expect(state).toMatchObject({ version: 1, alertIds: ['a'], folderId: 'default' });
		requestMock
			.mockReset()
			.mockResolvedValueOnce({
				name: state.templateName,
				type: 'http',
				isPrebuilt: false,
				title: '',
				body: ownedTemplateBody,
			})
			.mockResolvedValueOnce({
				name: state.destinationName,
				type: 'http',
				template: state.templateName,
				url: state.webhookUrl,
				headers: { 'X-N8N-OpenObserve-Secret': state.secret },
			})
			.mockResolvedValueOnce({ id: 'a', destinations: ['existing', state.destinationName] });
		await activateTrigger(context, state, {
			webhookUrl: state.webhookUrl!,
			folderId: 'default',
			alertIds: ['a'],
		});
		expect(requestMock.mock.calls.some((call) => ['POST', 'PUT'].includes(call[0].method))).toBe(
			false,
		);
	});
	it('normalizes selected IDs, creates a meaningful JSON template, and requires workflow identity', async () => {
		const state: TriggerState = {};
		requestMock
			.mockRejectedValueOnce(notFound())
			.mockResolvedValueOnce({})
			.mockRejectedValueOnce(notFound())
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ id: 'a', destinations: [] })
			.mockResolvedValueOnce({});
		await activateTrigger(hook(state), state, {
			webhookUrl: 'https://n8n.test',
			folderId: 'default',
			alertIds: ['', ' a ', 'a'],
		});
		expect(state.alertIds).toEqual(['a']);
		const templateCreate = requestMock.mock.calls.find(
			(call) =>
				call[0].method === 'POST' &&
				call[0].pathSegments[call[0].pathSegments.length - 1] === 'templates',
		)?.[0];
		const template = JSON.parse(String(templateCreate?.body.body)) as Record<string, string>;
		expect(template).toMatchObject({
			event: 'alert_triggered',
			organization: '{org_name}',
			streamName: '{stream_name}',
			alertName: '{alert_name}',
			triggerTime: '{alert_trigger_time}',
			count: '{alert_count}',
			aggregationValue: '{alert_agg_value}',
			threshold: '{alert_threshold}',
			operator: '{alert_operator}',
			alertUrl: '{alert_url}',
		});

		requestMock.mockReset();
		const missingWorkflow = hook({}) as unknown as {
			getWorkflow: () => { id?: string };
		};
		missingWorkflow.getWorkflow = () => ({});
		await expect(
			activateTrigger(
				missingWorkflow as IHookFunctions,
				{},
				{
					webhookUrl: 'https://n8n.test',
					folderId: 'default',
					alertIds: ['a'],
				},
			),
		).rejects.toThrow(/stable workflow ID/);
		expect(requestMock).not.toHaveBeenCalled();
		await expect(
			activateTrigger(
				hook({}),
				{},
				{
					webhookUrl: 'https://n8n.test',
					folderId: '   ',
					alertIds: ['a'],
				},
			),
		).rejects.toThrow(/folder ID is required/);
		expect(requestMock).not.toHaveBeenCalled();
	});
	it('fails closed on collision and rolls created artifacts back after attachment failure', async () => {
		requestMock.mockResolvedValueOnce({
			name: ownershipNames('workflow-1', 'node-1').templateName,
			type: 'http',
		});
		await expect(
			activateTrigger(
				hook({}),
				{},
				{ webhookUrl: 'https://n8n.test', folderId: 'default', alertIds: ['a'] },
			),
		).rejects.toThrow(/collision/);
		requestMock
			.mockReset()
			.mockRejectedValueOnce(notFound())
			.mockResolvedValueOnce({})
			.mockRejectedValueOnce(notFound())
			.mockResolvedValueOnce({})
			.mockRejectedValueOnce(new Error('alert failed'))
			.mockResolvedValue({});
		await expect(
			activateTrigger(
				hook({}),
				{},
				{ webhookUrl: 'https://n8n.test', folderId: 'default', alertIds: ['a'] },
			),
		).rejects.toThrow();
		const deletes = requestMock.mock.calls.filter((call) => call[0].method === 'DELETE');
		expect(deletes).toHaveLength(2);
		expect(deletes[0][0].pathSegments).toContain('destinations');
	});
	it('refuses destination collisions, owned-artifact tampering, and changed selections', async () => {
		const names = ownershipNames('workflow-1', 'node-1');
		requestMock
			.mockRejectedValueOnce(notFound())
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ name: names.destinationName, type: 'http' })
			.mockResolvedValueOnce({});
		await expect(
			activateTrigger(
				hook({}),
				{},
				{
					webhookUrl: 'https://n8n.test',
					folderId: 'default',
					alertIds: ['a'],
				},
			),
		).rejects.toThrow(/Destination name collision/);
		expect(requestMock.mock.calls[requestMock.mock.calls.length - 1]?.[0]).toMatchObject({
			method: 'DELETE',
			pathSegments: ['alerts', 'templates', names.templateName],
		});

		const state: TriggerState = {
			version: 1,
			...names,
			secret: 'secret',
			webhookUrl: 'https://n8n.test',
			folderId: 'default',
			alertIds: ['a'],
		};
		requestMock.mockReset().mockResolvedValueOnce({
			name: names.templateName,
			type: 'http',
			isPrebuilt: false,
			title: 'tampered',
			body: ownedTemplateBody,
		});
		await expect(
			activateTrigger(hook(state), state, {
				webhookUrl: 'https://n8n.test',
				folderId: 'default',
				alertIds: ['a'],
			}),
		).rejects.toThrow(/no longer matches/);
		requestMock.mockReset();
		await expect(
			activateTrigger(hook(state), state, {
				webhookUrl: 'https://n8n.test',
				folderId: 'default',
				alertIds: ['different'],
			}),
		).rejects.toThrow(/changing its selected alerts/);
		expect(requestMock).not.toHaveBeenCalled();
	});
	it('reports rollback failure without exposing the webhook secret', async () => {
		requestMock
			.mockRejectedValueOnce(notFound())
			.mockResolvedValueOnce({})
			.mockRejectedValueOnce(notFound())
			.mockResolvedValueOnce({})
			.mockRejectedValueOnce(new Error('attach failed'))
			.mockRejectedValueOnce(new Error('destination rollback failed with secret-value'))
			.mockResolvedValueOnce({});
		await expect(
			activateTrigger(
				hook({}),
				{},
				{
					webhookUrl: 'https://n8n.test',
					folderId: 'default',
					alertIds: ['a'],
				},
			),
		).rejects.toThrow('Trigger activation failed; rollback also failed in 1 step(s)');
		const deletes = requestMock.mock.calls.filter((call) => call[0].method === 'DELETE');
		expect(deletes.map((call) => call[0].pathSegments.at(-2))).toEqual([
			'destinations',
			'templates',
		]);
	});
	it('removes only its destination, preserves unrelated state, deletes owned artifacts, and clears state', async () => {
		const names = ownershipNames('workflow-1', 'node-1');
		const state: TriggerState = {
			version: 1,
			...names,
			secret: 's',
			webhookUrl: 'https://n8n.test',
			folderId: 'default',
			alertIds: ['a'],
		};
		requestMock
			.mockResolvedValueOnce({
				id: 'a',
				description: 'keep',
				destinations: ['other', names.destinationName],
			})
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ id: 'a', destinations: ['other'] })
			.mockResolvedValueOnce({ id: 'a', destinations: ['other'] })
			.mockResolvedValueOnce({
				name: names.destinationName,
				type: 'http',
				template: names.templateName,
				url: 'https://n8n.test',
				headers: { 'X-N8N-OpenObserve-Secret': 's' },
			})
			.mockResolvedValueOnce({ list: [] })
			.mockResolvedValueOnce({ list: [] })
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce({
				name: names.templateName,
				type: 'http',
				isPrebuilt: false,
				title: '',
				body: ownedTemplateBody,
			})
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce({})
			.mockRejectedValueOnce(notFound());
		await deactivateTrigger(hook(state), state);
		expect(requestMock.mock.calls[1][0].body).toMatchObject({
			description: 'keep',
			destinations: ['other'],
		});
		expect(state).toEqual({});
	});
	it('retains state when a reference scan is malformed', async () => {
		const names = ownershipNames('workflow-1', 'node-1');
		const state: TriggerState = {
			version: 1,
			...names,
			secret: 's',
			webhookUrl: 'https://n8n.test',
			folderId: 'default',
			alertIds: [],
		};
		requestMock
			.mockResolvedValueOnce({
				name: names.destinationName,
				type: 'http',
				template: names.templateName,
				url: state.webhookUrl,
				headers: { 'X-N8N-OpenObserve-Secret': state.secret },
			})
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({
				name: names.templateName,
				type: 'http',
				isPrebuilt: false,
				title: '',
				body: ownedTemplateBody,
			})
			.mockResolvedValueOnce('malformed');
		await expect(deactivateTrigger(hook(state), state)).rejects.toThrow(/cleanup failed/);
		expect(state.version).toBe(1);
		expect(requestMock.mock.calls.some((call) => call[0].method === 'DELETE')).toBe(false);
	});
	it('refuses malformed alert destinations during activation without mutating state', async () => {
		const names = ownershipNames('workflow-1', 'node-1');
		const state: TriggerState = {
			version: 1,
			...names,
			secret: 's',
			webhookUrl: 'https://n8n.test',
			folderId: 'default',
			alertIds: ['a'],
		};
		requestMock
			.mockResolvedValueOnce({
				name: names.templateName,
				type: 'http',
				isPrebuilt: false,
				title: '',
				body: ownedTemplateBody,
			})
			.mockResolvedValueOnce({
				name: names.destinationName,
				type: 'http',
				template: names.templateName,
				url: state.webhookUrl,
				headers: { 'X-N8N-OpenObserve-Secret': state.secret },
			})
			.mockResolvedValueOnce({ id: 'a' });
		await expect(
			activateTrigger(hook(state), state, {
				webhookUrl: state.webhookUrl!,
				folderId: 'default',
				alertIds: ['a'],
			}),
		).rejects.toThrow(/malformed destinations/);
		expect(requestMock.mock.calls.some((call) => ['PUT', 'DELETE'].includes(call[0].method))).toBe(
			false,
		);
		expect(state.version).toBe(1);
	});
	it.each([
		['folder entry', { list: [{ folderId: '' }] }, undefined],
		['full alert destinations', { list: [] }, { list: [{ alert_id: 'other' }] }],
	])(
		'retains ownership on malformed %s during reference scanning',
		async (_label, folders, alerts) => {
			const names = ownershipNames('workflow-1', 'node-1');
			const state: TriggerState = {
				version: 1,
				...names,
				secret: 's',
				webhookUrl: 'https://n8n.test',
				folderId: 'default',
				alertIds: [],
			};
			requestMock
				.mockResolvedValueOnce({
					name: names.destinationName,
					type: 'http',
					template: names.templateName,
					url: state.webhookUrl,
					headers: { 'X-N8N-OpenObserve-Secret': state.secret },
				})
				.mockResolvedValueOnce(folders);
			if (alerts) requestMock.mockResolvedValueOnce(alerts).mockResolvedValueOnce({ id: 'other' });
			requestMock.mockRejectedValueOnce(notFound());
			await expect(deactivateTrigger(hook(state), state)).rejects.toThrow(/cleanup failed/);
			expect(requestMock.mock.calls.some((call) => call[0].method === 'DELETE')).toBe(false);
			expect(state.version).toBe(1);
		},
	);
});

describe('OpenObserve Trigger dynamic selectors', () => {
	beforeEach(() => requestMock.mockReset());
	it('deduplicates Default folders and scopes alerts to the selected locator', async () => {
		const trigger = new OpenObserveTrigger();
		requestMock.mockResolvedValueOnce({
			list: [
				{ folderId: 'default', name: 'Default' },
				{ folderId: 'team', name: 'Team' },
			],
		});
		const folders = await trigger.methods.listSearch.searchAlertFolders.call(
			{} as ILoadOptionsFunctions,
			'',
		);
		expect(folders.results).toEqual([
			{ name: 'Default', value: 'default' },
			{ name: 'Team', value: 'team' },
		]);
		requestMock.mockResolvedValueOnce({ list: [{ alert_id: 'a', name: 'Alert A' }] });
		const alerts = await trigger.methods.loadOptions.getAlerts.call({
			getNodeParameter: () => ({ mode: 'list', value: 'team' }),
		} as unknown as ILoadOptionsFunctions);
		expect(alerts).toEqual([{ name: 'Alert A', value: 'a' }]);
		expect(requestMock.mock.calls[requestMock.mock.calls.length - 1]?.[0]).toMatchObject({
			apiPathMode: 'v2',
			pathSegments: ['alerts'],
			query: { folder: 'team', page_size: 100, page_idx: 0 },
		});
	});
});

describe('OpenObserve Trigger lifecycle hooks', () => {
	beforeEach(() => requestMock.mockReset());
	it('uses create for first activation, check for restart reconciliation, and delete for cleanup', async () => {
		const methods = new OpenObserveTrigger().webhookMethods.default;
		const state: TriggerState = {};
		const context = {
			...hook(state),
			getNodeWebhookUrl: () => 'https://n8n.test/webhook',
			getNodeParameter: (name: string) => (name === 'alertFolder' ? 'default' : ['a']),
		} as unknown as IHookFunctions;
		expect(await methods.checkExists.call(context)).toBe(false);
		expect(requestMock).not.toHaveBeenCalled();
		requestMock
			.mockRejectedValueOnce(notFound())
			.mockResolvedValueOnce({})
			.mockRejectedValueOnce(notFound())
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ id: 'a', destinations: [] })
			.mockResolvedValueOnce({});
		expect(await methods.create.call(context)).toBe(true);
		expect(state).toMatchObject({ version: 1, alertIds: ['a'] });

		requestMock
			.mockReset()
			.mockResolvedValueOnce({
				name: state.templateName,
				type: 'http',
				isPrebuilt: false,
				title: '',
				body: ownedTemplateBody,
			})
			.mockResolvedValueOnce({
				name: state.destinationName,
				type: 'http',
				template: state.templateName,
				url: state.webhookUrl,
				headers: { 'X-N8N-OpenObserve-Secret': state.secret },
			})
			.mockResolvedValueOnce({ id: 'a', destinations: [state.destinationName] });
		expect(await methods.checkExists.call(context)).toBe(true);
		expect(requestMock.mock.calls.some((call) => ['POST', 'PUT'].includes(call[0].method))).toBe(
			false,
		);

		requestMock
			.mockReset()
			.mockResolvedValueOnce({ id: 'a', destinations: [state.destinationName] })
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce({ id: 'a', destinations: [] })
			.mockResolvedValueOnce({ id: 'a', destinations: [] })
			.mockResolvedValueOnce({
				name: state.destinationName,
				type: 'http',
				template: state.templateName,
				url: state.webhookUrl,
				headers: { 'X-N8N-OpenObserve-Secret': state.secret },
			})
			.mockResolvedValueOnce({ list: [] })
			.mockResolvedValueOnce({ list: [] })
			.mockResolvedValueOnce({})
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce({
				name: state.templateName,
				type: 'http',
				isPrebuilt: false,
				title: '',
				body: ownedTemplateBody,
			})
			.mockResolvedValueOnce([])
			.mockResolvedValueOnce({})
			.mockRejectedValueOnce(notFound());
		expect(await methods.delete.call(context)).toBe(true);
		expect(state).toEqual({});
	});
});
