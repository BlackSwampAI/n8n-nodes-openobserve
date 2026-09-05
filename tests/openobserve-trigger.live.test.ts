/* eslint-disable @n8n/community-nodes/no-restricted-imports -- Guarded local receiver fixture. */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import type { IHookFunctions, IHttpRequestOptions, INode, IWebhookFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';
import { OpenObserveTrigger } from '../nodes/OpenObserveTrigger/OpenObserveTrigger.node';
import { ownershipNames, type TriggerState } from '../nodes/OpenObserveTrigger/lifecycle';

const live = process.env.OPENOBSERVE_LIVE === '1' ? describe : describe.skip;
const baseUrl = process.env.OPENOBSERVE_BASE_URL ?? 'http://127.0.0.1:5080';
const organizationId = process.env.OPENOBSERVE_ORG ?? 'default';
const receiverHost = process.env.OPENOBSERVE_LIVE_RECEIVER_HOST ?? '';
const suffix = (process.env.OPENOBSERVE_LIVE_RUN_ID ?? `pid_${process.pid}`)
	.toLowerCase()
	.replace(/[^a-z0-9]/g, '_')
	.slice(0, 20);
const prefix = `n8n_b6_${suffix}`;
const credentials = {
	baseUrl,
	organizationId,
	accountIdentifier: 'root@example.test',
	secret: 'OpenObserve-Local-Test-Only-9x!',
};
const node: INode = {
	id: `${prefix}_node`,
	name: 'OpenObserve Trigger',
	type: 'openObserveTrigger',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};

function guard() {
	const hostname = new URL(baseUrl).hostname;
	if (
		!['127.0.0.1', '::1', 'localhost'].includes(hostname) ||
		organizationId !== 'default' ||
		!/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(receiverHost)
	)
		throw new Error(
			'Batch 6 live tests require loopback OpenObserve, org default, and a private Docker bridge receiver',
		);
}
async function request(options: IHttpRequestOptions): Promise<unknown> {
	const url = new URL(options.url);
	for (const [key, raw] of Object.entries(options.qs ?? {}))
		for (const value of Array.isArray(raw) ? raw : [raw])
			if (value !== undefined) url.searchParams.append(key, String(value));
	const response = await fetch(url, {
		method: options.method,
		headers: {
			Authorization: `Basic ${Buffer.from(`${credentials.accountIdentifier}:${credentials.secret}`).toString('base64')}`,
			...(options.body === undefined ? {} : { 'Content-Type': 'application/json' }),
		},
		body: options.body === undefined ? undefined : JSON.stringify(options.body),
		signal: AbortSignal.timeout(10_000),
	});
	const text = await response.text();
	const body = text ? (JSON.parse(text) as unknown) : {};
	if (!response.ok) throw { statusCode: response.status, message: text };
	return body;
}
const raw = (method: IHttpRequestOptions['method'], path: string, body?: unknown) =>
	request({ method, url: `${baseUrl}${path}`, body: body as IHttpRequestOptions['body'] });
function hook(state: TriggerState, webhookUrl = '', alertId = ''): IHookFunctions {
	return {
		getCredentials: async () => credentials,
		getNode: () => node,
		getWorkflow: () => ({ id: `${prefix}_workflow` }),
		getWorkflowStaticData: () => state,
		getNodeWebhookUrl: () => webhookUrl,
		getNodeParameter: (name: string) => {
			if (name === 'alertFolder') return { mode: 'list', value: 'default' };
			if (name === 'alertIds') return alertId ? [alertId] : [];
			return undefined;
		},
		helpers: {
			httpRequestWithAuthentication: async (_name: string, options: IHttpRequestOptions) =>
				request(options),
		},
	} as unknown as IHookFunctions;
}

live('pinned OpenObserve v0.92.2 Batch 6 trigger lifecycle', () => {
	it('preserves an existing destination, delivers through webhook(), reconciles, and cleans exactly', async () => {
		guard();
		const stream = `${prefix}_stream`;
		const otherTemplate = `${prefix}_other_template`;
		const otherDestination = `${prefix}_other_destination`;
		const alertName = `${prefix}_alert`;
		const state: TriggerState = {};
		let alertId = '';
		let accepted = false;
		let receivedBody: Record<string, unknown> | undefined;
		const trigger = new OpenObserveTrigger();
		const lifecycleMethods = trigger.webhookMethods.default;
		const receiver = createServer((incoming, response) => {
			let text = '';
			incoming.on('data', (chunk) => {
				text += String(chunk);
			});
			incoming.on('end', () => {
				void (async () => {
					const body = JSON.parse(text) as Record<string, unknown>;
					receivedBody = body;
					let statusCode = 200;
					const responseFacade = {
						status: (code: number) => {
							statusCode = code;
							return responseFacade;
						},
						send: () => responseFacade,
						end: () => responseFacade,
					};
					const result = await trigger.webhook.call({
						getWorkflowStaticData: () => state,
						getRequestObject: () => ({ rawHeaders: incoming.rawHeaders }),
						getHeaderData: () => incoming.headers,
						getBodyData: () => body,
						getResponseObject: () => responseFacade,
					} as unknown as IWebhookFunctions);
					accepted = statusCode === 200 && Boolean(result.workflowData);
					response.statusCode = statusCode;
					response.end('ok');
				})().catch(() => {
					response.statusCode = 500;
					response.end('error');
				});
			});
		});
		await new Promise<void>((resolve, reject) => {
			receiver.once('error', reject);
			receiver.listen(0, receiverHost, resolve);
		});
		const webhookUrl = `http://${receiverHost}:${(receiver.address() as AddressInfo).port}/openobserve`;
		try {
			await raw('POST', `/api/${organizationId}/${stream}/_json`, [
				{ level: 'info', message: 'seed' },
			]);
			await raw('POST', `/api/${organizationId}/alerts/templates`, {
				name: otherTemplate,
				type: 'http',
				title: '',
				body: '{"other":true}',
				isPrebuilt: false,
			});
			await raw('POST', `/api/${organizationId}/alerts/destinations?module=alert`, {
				name: otherDestination,
				type: 'http',
				template: otherTemplate,
				url: webhookUrl,
				method: 'post',
				headers: {},
				skip_tls_verify: false,
			});
			const created = (await raw('POST', `/api/v2/${organizationId}/alerts?folder=default`, {
				name: alertName,
				stream_type: 'logs',
				stream_name: stream,
				is_real_time: true,
				alert_type: 'realtime',
				query_condition: {
					type: 'custom',
					conditions: { column: 'level', operator: '=', value: 'error', ignore_case: false },
				},
				trigger_condition: {
					period: 1,
					operator: '>=',
					threshold: 1,
					frequency: 1,
					frequency_type: 'minutes',
					silence: 0,
				},
				destinations: [otherDestination],
				description: 'preserve-me',
				enabled: true,
			})) as { id?: string };
			alertId = created.id ?? '';
			expect(alertId).not.toBe('');
			const lifecycleContext = hook(state, webhookUrl, alertId);
			expect(await lifecycleMethods.create.call(lifecycleContext)).toBe(true);
			expect(await lifecycleMethods.checkExists.call(lifecycleContext)).toBe(true);
			const attached = (await raw(
				'GET',
				`/api/v2/${organizationId}/alerts/${alertId}?folder=default`,
			)) as { destinations?: string[]; description?: string };
			expect(attached.destinations).toEqual([otherDestination, state.destinationName]);
			expect(attached.description).toBe('preserve-me');
			await raw('POST', `/api/${organizationId}/${stream}/_json`, [
				{ level: 'error', message: 'trigger' },
			]);
			for (let attempt = 0; attempt < 20 && !accepted; attempt++) await delay(250);
			expect(accepted).toBe(true);
			expect(receivedBody).toMatchObject({
				event: 'alert_triggered',
				organization: organizationId,
				streamType: 'logs',
				streamName: stream,
				alertName,
				alertType: 'realtime',
			});
			expect(receivedBody).toHaveProperty('triggerTime');
			expect(receivedBody).toHaveProperty('count');
			expect(receivedBody).toHaveProperty('threshold');
			expect(receivedBody).toHaveProperty('operator');
			expect(receivedBody).toHaveProperty('alertUrl');
			expect(await lifecycleMethods.delete.call(lifecycleContext)).toBe(true);
			const detached = (await raw(
				'GET',
				`/api/v2/${organizationId}/alerts/${alertId}?folder=default`,
			)) as { destinations?: string[]; description?: string };
			expect(detached.destinations).toEqual([otherDestination]);
			expect(detached.description).toBe('preserve-me');
			expect(state).toEqual({});
		} finally {
			await new Promise<void>((resolve) => receiver.close(() => resolve()));
			if (alertId)
				await raw('DELETE', `/api/v2/${organizationId}/alerts/${alertId}?folder=default`).catch(
					() => undefined,
				);
			const names = ownershipNames(`${prefix}_workflow`, node.id);
			for (const destinationName of [names.destinationName, otherDestination])
				await raw(
					'DELETE',
					`/api/${organizationId}/alerts/destinations/${destinationName}?module=alert`,
				).catch(() => undefined);
			await raw('DELETE', `/api/${organizationId}/alerts/templates/${names.templateName}`).catch(
				() => undefined,
			);
			await raw('DELETE', `/api/${organizationId}/alerts/templates/${otherTemplate}`).catch(
				() => undefined,
			);
			await raw(
				'DELETE',
				`/api/${organizationId}/streams/${stream}?type=logs&delete_all=false`,
			).catch(() => undefined);
			const alerts = (await raw(
				'GET',
				`/api/v2/${organizationId}/alerts?page_size=100&page_idx=0&folder=default`,
			)) as { list?: Array<{ name?: string }> };
			expect(alerts.list?.some((entry) => entry.name === alertName)).toBe(false);
			const destinations = (await raw(
				'GET',
				`/api/${organizationId}/alerts/destinations?module=alert`,
			)) as Array<{ name?: string }>;
			expect(
				destinations.some((entry) =>
					[otherDestination, names.destinationName].includes(entry.name ?? ''),
				),
			).toBe(false);
			const templates = (await raw('GET', `/api/${organizationId}/alerts/templates`)) as Array<{
				name?: string;
			}>;
			expect(
				templates.some((entry) => [otherTemplate, names.templateName].includes(entry.name ?? '')),
			).toBe(false);
		}
	});
});
