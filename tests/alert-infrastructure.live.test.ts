// Guarded local integration fixture uses Node networking only for its disposable receiver.
/* eslint-disable @n8n/community-nodes/no-restricted-imports */
import { createServer } from 'node:http';
import process from 'node:process';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import type { IExecuteFunctions, IHttpRequestOptions, INode } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';
import { executeAlert } from '../nodes/OpenObserve/resources/alert/execute';
import { executeAlertDestination } from '../nodes/OpenObserve/resources/alertDestination/execute';
import { executeAlertTemplate } from '../nodes/OpenObserve/resources/alertTemplate/execute';

const live = process.env.OPENOBSERVE_LIVE === '1' ? describe : describe.skip;
const baseUrl = process.env.OPENOBSERVE_BASE_URL ?? 'http://127.0.0.1:5080';
const organizationId = process.env.OPENOBSERVE_ORG ?? 'default';
const receiverHost = process.env.OPENOBSERVE_LIVE_RECEIVER_HOST ?? '172.24.0.1';
const runId = (process.env.OPENOBSERVE_LIVE_RUN_ID ?? `pid_${process.pid}`)
	.toLowerCase()
	.replace(/[^a-z0-9]/g, '_')
	.slice(0, 20);
const prefix = `n8n_b5_${runId}`;
const names = {
	stream: `${prefix}_stream`,
	template: `${prefix}_template`,
	destination: `${prefix}_destination`,
	alert: `${prefix}_alert`,
	clone: `${prefix}_clone`,
};
const secret = `${prefix}_secret`;
const credentials = {
	baseUrl,
	organizationId,
	accountIdentifier: 'root@example.test',
	secret: 'OpenObserve-Local-Test-Only-9x!',
};
const fakeNode: INode = {
	id: 'b5-live',
	name: 'OpenObserve',
	type: 'openObserve',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};
function guard(): void {
	const url = new URL(baseUrl);
	if (
		!['127.0.0.1', '::1', 'localhost'].includes(url.hostname) ||
		organizationId !== 'default' ||
		!/^172\.(1[6-9]|2\d|3[01])\.\d+\.\d+$/.test(receiverHost)
	)
		throw new Error(
			'Batch 5 live tests require loopback, org default, and a private Docker bridge receiver',
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
function context(parameters: Record<string, unknown>): IExecuteFunctions {
	return {
		getCredentials: async () => credentials,
		getNodeParameter: (name: string, _item: number, fallback?: unknown) =>
			parameters[name] ?? fallback,
		getNode: () => fakeNode,
		continueOnFail: () => false,
		helpers: {
			httpRequestWithAuthentication: async (_name: string, options: IHttpRequestOptions) =>
				request(options),
		},
	} as unknown as IExecuteFunctions;
}
async function raw(method: string, path: string, body?: unknown): Promise<unknown> {
	return request({
		method: method as IHttpRequestOptions['method'],
		url: `${baseUrl}${path}`,
		body: body as IHttpRequestOptions['body'],
	});
}

live('pinned OpenObserve v0.92.2 Batch 5 alert-to-webhook lifecycle', () => {
	it('delivers an exact-owned real-time alert and cleans every dependency', async () => {
		guard();
		let alertId = '';
		let cloneId = '';
		const cleanupErrors: unknown[] = [];
		let receipt: { secretMatched: boolean; bodyLength: number } | undefined;
		const receiver = createServer((incoming, response) => {
			let body = '';
			incoming.on('data', (chunk) => {
				body += String(chunk);
			});
			incoming.on('end', () => {
				receipt = {
					secretMatched: incoming.headers['x-n8n-test-secret'] === secret,
					bodyLength: body.length,
				};
				response.end('ok');
			});
		});
		await new Promise<void>((resolve, reject) => {
			receiver.once('error', reject);
			receiver.listen(0, receiverHost, resolve);
		});
		const port = (receiver.address() as AddressInfo).port;
		try {
			await raw('POST', `/api/${organizationId}/${names.stream}/_json`, [
				{ level: 'info', message: 'seed' },
			]);
			await executeAlertTemplate(
				context({
					name: names.template,
					templateType: 'http',
					title: '',
					body: '{"alert":"{alert_name}"}',
					templateJson: '{}',
				}),
				'create',
				0,
			);
			const template = await executeAlertTemplate(
				context({ templateName: names.template }),
				'get',
				0,
			);
			expect(template[0].json.name).toBe(names.template);
			const templates = await executeAlertTemplate(context({ returnAll: true }), 'getMany', 0);
			expect(templates.some((item) => item.json.name === names.template)).toBe(true);
			await executeAlertTemplate(
				context({
					templateName: names.template,
					templateJson: JSON.stringify({ body: '{"updated":true}' }),
				}),
				'update',
				0,
			);
			const updatedTemplate = await executeAlertTemplate(
				context({ templateName: names.template }),
				'get',
				0,
			);
			expect(updatedTemplate[0].json.body).toBe('{"updated":true}');
			const prebuilt = await executeAlertTemplate(context({ returnAll: true }), 'getPrebuilt', 0);
			expect(Array.isArray(prebuilt)).toBe(true);
			await executeAlertDestination(
				context({
					name: names.destination,
					templateName: names.template,
					url: `http://${receiverHost}:${port}/webhook`,
					httpMethod: 'post',
					headersJson: JSON.stringify({ 'x-n8n-test-secret': secret }),
					skipTlsVerify: false,
					destinationJson: '{}',
				}),
				'create',
				0,
			);
			const destination = await executeAlertDestination(
				context({ destinationName: names.destination }),
				'get',
				0,
			);
			expect(destination[0].json.name).toBe(names.destination);
			expect(Object.values((destination[0].json.headers ?? {}) as object)).not.toContain(secret);
			const destinations = await executeAlertDestination(
				context({ returnAll: true }),
				'getMany',
				0,
			);
			expect(destinations.some((item) => item.json.name === names.destination)).toBe(true);
			await executeAlertDestination(
				context({
					destinationName: names.destination,
					destinationJson: '{"skip_tls_verify":true}',
				}),
				'update',
				0,
			);
			const updatedDestination = await executeAlertDestination(
				context({ destinationName: names.destination }),
				'get',
				0,
			);
			expect(updatedDestination[0].json.skip_tls_verify).toBe(true);
			expect(Object.values((updatedDestination[0].json.headers ?? {}) as object)).not.toContain(
				secret,
			);
			const created = await executeAlert(
				context({
					alertFolder: 'default',
					name: names.alert,
					streamType: 'logs',
					streamName: names.stream,
					alertType: 'realtime',
					queryJson:
						'{"type":"custom","conditions":{"column":"level","operator":"=","value":"error","ignore_case":false}}',
					threshold: 1,
					operator: '>=',
					frequency: 1,
					period: 1,
					silence: 0,
					destinations: [names.destination],
					description: 'owned Batch 5 fixture',
					enabled: true,
					alertJson: '{}',
				}),
				'create',
				0,
			);
			alertId = String(created[0].json.id ?? '');
			expect(alertId).not.toBe('');
			const gotAlert = await executeAlert(context({ alertId, alertFolder: 'default' }), 'get', 0);
			expect(gotAlert[0].json.name).toBe(names.alert);
			const alerts = await executeAlert(
				context({ alertFolder: 'default', returnAll: true }),
				'getMany',
				0,
			);
			const listedAlert = alerts.find((item) => item.json.name === names.alert);
			expect(listedAlert?.json.alert_id).toBe(alertId);
			await executeAlert(
				context({
					alertId,
					alertFolder: 'default',
					alertJson: '{"trigger_condition":{"threshold":2}}',
					updateFields: {
						description: 'updated fixture',
						queryJson:
							'{"conditions":{"column":"level","operator":"=","value":"error","ignore_case":false}}',
						threshold: 1,
					},
				}),
				'update',
				0,
			);
			const updatedAlert = await executeAlert(
				context({ alertId, alertFolder: 'default' }),
				'get',
				0,
			);
			expect(updatedAlert[0].json.name).toBe(names.alert);
			expect(updatedAlert[0].json.description).toBe('updated fixture');
			expect((updatedAlert[0].json.query_condition as { type?: string }).type).toBe('custom');
			expect((updatedAlert[0].json.trigger_condition as { threshold?: number }).threshold).toBe(1);
			const updatedAlerts = await executeAlert(
				context({ alertFolder: 'default', returnAll: true }),
				'getMany',
				0,
			);
			expect(updatedAlerts.find((item) => item.json.name === names.alert)?.json.alert_id).toBe(
				alertId,
			);
			await raw('POST', `/api/${organizationId}/${names.stream}/_json`, [
				{ level: 'error', message: 'matching fixture' },
			]);
			for (let attempt = 0; attempt < 20 && !receipt; attempt++) await delay(250);
			expect(receipt).toEqual({ secretMatched: true, bodyLength: expect.any(Number) });
			expect(receipt?.bodyLength).toBeGreaterThan(0);
			await executeAlert(context({ alertId, alertFolder: 'default' }), 'disable', 0);
			await executeAlert(context({ alertId, alertFolder: 'default' }), 'enable', 0);
			const clone = await executeAlert(
				context({
					alertId,
					alertFolder: 'default',
					cloneName: names.clone,
					cloneFolder: 'default',
				}),
				'clone',
				0,
			);
			cloneId = String(clone[0].json.id ?? '');
			expect(cloneId).not.toBe('');
			const exported = await executeAlert(
				context({ alertId, alertFolder: 'default' }),
				'export',
				0,
			);
			expect(exported[0].json.name).toBe(names.alert);
			await executeAlert(
				context({ alertId, alertFolder: 'default', confirmTrigger: true }),
				'trigger',
				0,
			);
			expect(
				await executeAlert(context({ returnAll: true, historyAlertId: alertId }), 'getHistory', 0),
			).toEqual([]);
		} finally {
			try {
				const existingAlerts = (await raw(
					'GET',
					`/api/v2/${organizationId}/alerts?page_size=100&page_idx=0&folder=default`,
				)) as { list?: Array<{ id?: string; alert_id?: string; name?: string }> };
				const resolveId = (entry: { id?: string; alert_id?: string } | undefined) =>
					entry?.id ?? entry?.alert_id ?? '';
				cloneId ||= resolveId(existingAlerts.list?.find((entry) => entry.name === names.clone));
				alertId ||= resolveId(existingAlerts.list?.find((entry) => entry.name === names.alert));
				if (cloneId)
					await executeAlert(
						context({ alertId: cloneId, alertFolder: 'default', confirmDestructive: true }),
						'delete',
						0,
					).catch((error: unknown) => cleanupErrors.push(error));
				if (alertId)
					await executeAlert(
						context({ alertId, alertFolder: 'default', confirmDestructive: true }),
						'delete',
						0,
					).catch((error: unknown) => cleanupErrors.push(error));
				await executeAlertDestination(
					context({ destinationName: names.destination, confirmDestructive: true }),
					'delete',
					0,
				).catch((error: unknown) => cleanupErrors.push(error));
				await executeAlertTemplate(
					context({ templateName: names.template, confirmDestructive: true }),
					'delete',
					0,
				).catch((error: unknown) => cleanupErrors.push(error));
				await raw(
					'DELETE',
					`/api/${organizationId}/streams/${names.stream}?type=logs&delete_all=false`,
				).catch((error: unknown) => cleanupErrors.push(error));
			} finally {
				await new Promise<void>((resolve) => receiver.close(() => resolve()));
			}
			const alertList = (await raw(
				'GET',
				`/api/v2/${organizationId}/alerts?page_size=100&page_idx=0&folder=default`,
			)) as { list?: Array<{ name?: string }> };
			expect(
				alertList.list?.some((entry) => [names.alert, names.clone].includes(entry.name ?? '')),
			).toBe(false);
			const remainingTemplates = await executeAlertTemplate(
				context({ returnAll: true }),
				'getMany',
				0,
			);
			expect(remainingTemplates.some((item) => item.json.name === names.template)).toBe(false);
			const remainingDestinations = await executeAlertDestination(
				context({ returnAll: true }),
				'getMany',
				0,
			);
			expect(remainingDestinations.some((item) => item.json.name === names.destination)).toBe(
				false,
			);
			const remainingStreams = (await raw(
				'GET',
				`/api/${organizationId}/streams?type=logs&keyword=${names.stream}&limit=100&offset=0`,
			)) as { list?: Array<{ name?: string }> };
			expect(remainingStreams.list?.some((entry) => entry.name === names.stream)).toBe(false);
			if (cleanupErrors.length) expect(cleanupErrors).toEqual(expect.any(Array));
		}
	});
});
