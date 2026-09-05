// Guarded repository integration fixture intentionally uses Node-only facilities.
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import process from 'node:process';
import type { IExecuteFunctions, IHttpRequestOptions, INode } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';
import { executeDashboard } from '../nodes/OpenObserve/resources/dashboard/execute';
import { executeFunction } from '../nodes/OpenObserve/resources/function/execute';
const live = process.env.OPENOBSERVE_LIVE === '1' ? describe : describe.skip;
const baseUrl = process.env.OPENOBSERVE_BASE_URL ?? 'http://127.0.0.1:5080';
const organizationId = process.env.OPENOBSERVE_ORG ?? 'default';
const rawRunId = process.env.OPENOBSERVE_LIVE_RUN_ID ?? `pid_${process.pid}`;
const runId = rawRunId
	.toLowerCase()
	.replace(/[^a-z0-9]/g, '_')
	.replace(/_+/g, '_')
	.slice(0, 24);
const functionName = `n8n_b4_${runId}_function`;
const dashboardTitle = `n8n_b4_${runId}_dashboard`;
const credentials = {
	baseUrl,
	organizationId,
	accountIdentifier: 'root@example.test',
	secret: 'OpenObserve-Local-Test-Only-9x!',
};
const fakeNode: INode = {
	id: 'b4-live',
	name: 'OpenObserve',
	type: '@blackswampai/n8n-nodes-openobserve.openObserve',
	typeVersion: 1,
	position: [0, 0],
	parameters: {},
};
function guard(): void {
	const url = new URL(baseUrl);
	if (
		!['127.0.0.1', '::1', 'localhost'].includes(url.hostname) ||
		organizationId !== 'default' ||
		!runId
	)
		throw new Error('Batch 4 live tests require loopback and disposable org default');
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
async function removeFunction(): Promise<void> {
	try {
		await executeFunction(context({ functionName, confirmDestructive: true }), 'delete', 0);
	} catch {
		/* exact owned function may be absent */
	}
}
async function functionExists(): Promise<boolean> {
	const list = await executeFunction(context({ returnAll: true }), 'getMany', 0);
	return list.some((item) => item.json.name === functionName);
}
async function findDashboard(): Promise<{ dashboard_id: string } | undefined> {
	const list = await executeDashboard(
		context({ titleFilter: dashboardTitle, returnAll: true }),
		'getMany',
		0,
	);
	return list
		.map((item) => item.json as { dashboard_id?: string; title?: string })
		.find(
			(item) => item.title === dashboardTitle && item.dashboard_id && item.dashboard_id.length > 0,
		) as { dashboard_id: string } | undefined;
}
async function removeDashboard(dashboardId: string | undefined): Promise<void> {
	if (!dashboardId) return;
	try {
		await executeDashboard(
			context({ dashboardId, folderId: 'default', confirmDestructive: true }),
			'delete',
			0,
		);
	} catch {
		/* exact owned dashboard may be absent */
	}
}
live('pinned OpenObserve v0.92.2 Batch 4 lifecycle', () => {
	it('validates and manages one exact function and dashboard', async () => {
		guard();
		await removeFunction();
		let dashboardId = (await findDashboard())?.dashboard_id;
		await removeDashboard(dashboardId);
		dashboardId = undefined;
		try {
			const valid = await executeFunction(
				context({ vrl: '.batch4 = "valid"\n.', eventsJson: '[{"message":"hello"}]' }),
				'validate',
				0,
			);
			expect(valid[0].json.results).toBeDefined();
			await expect(
				executeFunction(context({ vrl: '.broken = !!!', eventsJson: '[{}]' }), 'validate', 0),
			).rejects.toThrow(/rejected/);
			await executeFunction(
				context({
					name: functionName,
					vrl: '.batch4 = "created"\n.',
					params: '',
					numArgs: 0,
					advancedJson: '{}',
				}),
				'create',
				0,
			);
			expect(await functionExists()).toBe(true);
			const dependencies = await executeFunction(context({ functionName }), 'getDependencies', 0);
			expect(dependencies[0].json.list).toEqual([]);
			await executeFunction(
				context({
					functionName,
					vrl: '.batch4 = "updated"\n.',
					params: '',
					numArgs: 0,
					advancedJson: '{}',
				}),
				'update',
				0,
			);
			const functions = await executeFunction(context({ returnAll: true }), 'getMany', 0);
			expect(functions.find((item) => item.json.name === functionName)?.json.function).toContain(
				'updated',
			);
			const created = await executeDashboard(
				context({
					folderId: 'default',
					title: dashboardTitle,
					description: 'created',
					dashboardJson: '{"version":8,"tabs":[]}',
				}),
				'create',
				0,
			);
			dashboardId = String(
				(created[0].json.v8 as { dashboardId?: string } | undefined)?.dashboardId ?? '',
			);
			expect(dashboardId).not.toBe('');
			const listed = await findDashboard();
			expect(listed?.dashboard_id).toBe(dashboardId);
			const got = await executeDashboard(context({ dashboardId, folderId: 'default' }), 'get', 0);
			expect((got[0].json.v8 as { title?: string }).title).toBe(dashboardTitle);
			await executeDashboard(
				context({
					dashboardId,
					folderId: 'default',
					updateFields: { description: 'updated' },
					dashboardJson: '{}',
				}),
				'update',
				0,
			);
			const updated = await executeDashboard(
				context({ dashboardId, folderId: 'default' }),
				'get',
				0,
			);
			expect((updated[0].json.v8 as { description?: string }).description).toBe('updated');
		} finally {
			dashboardId ||= (await findDashboard())?.dashboard_id;
			await removeDashboard(dashboardId);
			await removeFunction();
			expect(await findDashboard()).toBeUndefined();
			expect(await functionExists()).toBe(false);
		}
	});
});
