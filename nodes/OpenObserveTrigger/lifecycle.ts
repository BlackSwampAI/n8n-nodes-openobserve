import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { IDataObject, IHookFunctions } from 'n8n-workflow';
import { NodeOperationError, sleep } from 'n8n-workflow';
import { openObserveApiRequest } from '../OpenObserve/shared/transport';

export interface TriggerState extends IDataObject {
	version?: number;
	secret?: string;
	templateName?: string;
	destinationName?: string;
	webhookUrl?: string;
	folderId?: string;
	alertIds?: string[];
}
const OWNED_TEMPLATE_BODY = JSON.stringify({
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
const delay = async (milliseconds: number): Promise<void> => await sleep(milliseconds);

function lifecycleError(
	context: IHookFunctions,
	error: unknown,
	prefix?: string,
): NodeOperationError {
	const detail = error instanceof Error ? error.message : 'Unknown OpenObserve lifecycle error';
	return new NodeOperationError(context.getNode(), prefix ? `${prefix}: ${detail}` : detail);
}

export function ownershipNames(workflowId: string, nodeId: string) {
	const digest = createHash('sha256').update(`${workflowId}:${nodeId}`).digest('hex').slice(0, 24);
	return {
		templateName: `n8n_trigger_${digest}_template`,
		destinationName: `n8n_trigger_${digest}_destination`,
	};
}

export const generateWebhookSecret = (): string => randomBytes(32).toString('base64url');

export function validateWebhookSecret(expected: string, supplied: unknown): boolean {
	if (typeof supplied !== 'string' || !expected) return false;
	const expectedBytes = Buffer.from(expected);
	const suppliedBytes = Buffer.from(supplied);
	return (
		expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes)
	);
}

function isNotFound(error: unknown): boolean {
	return (
		typeof error === 'object' &&
		error !== null &&
		'httpCode' in error &&
		String((error as { httpCode?: unknown }).httpCode) === '404'
	);
}

async function getOptional(
	context: IHookFunctions,
	pathSegments: string[],
): Promise<Record<string, unknown> | undefined> {
	try {
		return (await openObserveApiRequest.call(context, { pathSegments })) as Record<string, unknown>;
	} catch (error) {
		if (isNotFound(error)) return undefined;
		throw lifecycleError(context, error);
	}
}

function assertOwnedTemplate(
	context: IHookFunctions,
	template: Record<string, unknown>,
	name: string,
): void {
	if (
		template.name !== name ||
		template.type !== 'http' ||
		template.isPrebuilt === true ||
		template.title !== '' ||
		template.body !== OWNED_TEMPLATE_BODY
	)
		throw new NodeOperationError(
			context.getNode(),
			`Owned template ${name} no longer matches this trigger`,
		);
}

function assertOwnedDestination(
	context: IHookFunctions,
	destination: Record<string, unknown>,
	state: TriggerState,
): void {
	const headers = destination.headers as Record<string, unknown> | undefined;
	if (
		destination.name !== state.destinationName ||
		destination.type !== 'http' ||
		destination.template !== state.templateName ||
		destination.url !== state.webhookUrl ||
		headers?.['X-N8N-OpenObserve-Secret'] !== state.secret
	)
		throw new NodeOperationError(
			context.getNode(),
			`Owned destination ${state.destinationName} no longer matches this trigger`,
		);
}

async function getAlert(context: IHookFunctions, id: string, folderId: string) {
	return (await openObserveApiRequest.call(context, {
		apiPathMode: 'v2',
		pathSegments: ['alerts', id],
		query: { folder: folderId },
	})) as Record<string, unknown>;
}

async function putAlert(
	context: IHookFunctions,
	id: string,
	folderId: string,
	alert: Record<string, unknown>,
) {
	await openObserveApiRequest.call(context, {
		apiPathMode: 'v2',
		method: 'PUT',
		pathSegments: ['alerts', id],
		query: { folder: folderId },
		body: alert,
	});
}

export async function activateTrigger(
	context: IHookFunctions,
	state: TriggerState,
	options: { webhookUrl: string; folderId: string; alertIds: string[] },
): Promise<void> {
	const alertIds = [...new Set(options.alertIds.map((id) => String(id).trim()).filter(Boolean))];
	if (!alertIds.length)
		throw new NodeOperationError(context.getNode(), 'Select at least one alert');
	const folderId = String(options.folderId).trim();
	if (!folderId) throw new NodeOperationError(context.getNode(), 'Alert folder ID is required');
	const workflowId = String(context.getWorkflow().id ?? '').trim();
	if (!workflowId)
		throw new NodeOperationError(
			context.getNode(),
			'A stable workflow ID is required to activate this trigger',
		);
	const names = ownershipNames(workflowId, context.getNode().id);
	const hasOwnership =
		state.version === 1 &&
		state.templateName === names.templateName &&
		state.destinationName === names.destinationName;
	const working: TriggerState = hasOwnership
		? state
		: {
				version: 1,
				secret: generateWebhookSecret(),
				...names,
				webhookUrl: options.webhookUrl,
				folderId,
				alertIds,
			};
	if (hasOwnership && (state.webhookUrl !== options.webhookUrl || state.folderId !== folderId))
		throw new NodeOperationError(
			context.getNode(),
			'Deactivate the trigger before changing its webhook or folder',
		);
	if (
		hasOwnership &&
		JSON.stringify([...(state.alertIds ?? [])].sort()) !== JSON.stringify([...alertIds].sort())
	)
		throw new NodeOperationError(
			context.getNode(),
			'Deactivate the trigger before changing its selected alerts',
		);

	const rollback: Array<() => Promise<void>> = [];
	try {
		const existingTemplate = await getOptional(context, [
			'alerts',
			'templates',
			names.templateName,
		]);
		if (existingTemplate) {
			if (!hasOwnership)
				throw new NodeOperationError(
					context.getNode(),
					`Template name collision: ${names.templateName}`,
				);
			assertOwnedTemplate(context, existingTemplate, names.templateName);
		} else {
			await openObserveApiRequest.call(context, {
				method: 'POST',
				pathSegments: ['alerts', 'templates'],
				body: {
					name: names.templateName,
					type: 'http',
					title: '',
					body: OWNED_TEMPLATE_BODY,
					isPrebuilt: false,
				},
			});
			rollback.push(async () => {
				await openObserveApiRequest.call(context, {
					method: 'DELETE',
					pathSegments: ['alerts', 'templates', names.templateName],
				});
			});
		}

		const existingDestination = await getOptional(context, [
			'alerts',
			'destinations',
			names.destinationName,
		]);
		if (existingDestination) {
			if (!hasOwnership)
				throw new NodeOperationError(
					context.getNode(),
					`Destination name collision: ${names.destinationName}`,
				);
			assertOwnedDestination(context, existingDestination, working);
		} else {
			await openObserveApiRequest.call(context, {
				method: 'POST',
				pathSegments: ['alerts', 'destinations'],
				query: { module: 'alert' },
				body: {
					name: names.destinationName,
					type: 'http',
					template: names.templateName,
					url: options.webhookUrl,
					method: 'post',
					headers: { 'X-N8N-OpenObserve-Secret': working.secret },
					skip_tls_verify: false,
				},
				sensitiveValues: [working.secret ?? ''],
			});
			rollback.push(async () => {
				await openObserveApiRequest.call(context, {
					method: 'DELETE',
					pathSegments: ['alerts', 'destinations', names.destinationName],
					query: { module: 'alert' },
				});
			});
		}

		for (const alertId of alertIds) {
			const alert = await getAlert(context, alertId, folderId);
			if (!Array.isArray(alert.destinations))
				throw new NodeOperationError(
					context.getNode(),
					`Alert ${alertId} returned malformed destinations`,
				);
			const before = [...alert.destinations];
			if (!before.includes(names.destinationName)) {
				await putAlert(context, alertId, folderId, {
					...alert,
					destinations: [...before, names.destinationName],
				});
				rollback.push(() =>
					putAlert(context, alertId, folderId, { ...alert, destinations: before }),
				);
			}
		}
		Object.assign(state, working, { alertIds: [...alertIds] });
	} catch (error) {
		let rollbackFailures = 0;
		for (const undo of rollback.reverse())
			try {
				await undo();
			} catch {
				rollbackFailures += 1;
			}
		if (rollbackFailures)
			throw lifecycleError(
				context,
				error,
				`Trigger activation failed; rollback also failed in ${rollbackFailures} step(s)`,
			);
		throw lifecycleError(context, error);
	}
}

export async function deactivateTrigger(
	context: IHookFunctions,
	state: TriggerState,
): Promise<void> {
	if (state.version !== 1 || !state.destinationName || !state.templateName) return;
	const errors: unknown[] = [];
	let retained = false;
	for (const alertId of state.alertIds ?? []) {
		try {
			const alert = await getAlert(context, alertId, state.folderId ?? 'default');
			const current = Array.isArray(alert.destinations) ? alert.destinations : [];
			if (current.includes(state.destinationName))
				await putAlert(context, alertId, state.folderId ?? 'default', {
					...alert,
					destinations: current.filter((value) => value !== state.destinationName),
				});
			let detached = false;
			let consecutiveDetachedReads = 0;
			for (let attempt = 0; attempt < 8; attempt++) {
				const confirmed = await getAlert(context, alertId, state.folderId ?? 'default');
				if (!Array.isArray(confirmed.destinations))
					throw new NodeOperationError(
						context.getNode(),
						`Alert ${alertId} returned malformed destinations`,
					);
				if (!confirmed.destinations.includes(state.destinationName)) {
					consecutiveDetachedReads += 1;
					if (consecutiveDetachedReads >= 2) {
						detached = true;
						break;
					}
				} else consecutiveDetachedReads = 0;
				await delay(250);
			}
			if (!detached)
				throw new NodeOperationError(
					context.getNode(),
					`Could not confirm trigger detachment from alert ${alertId}`,
				);
		} catch (error) {
			if (!isNotFound(error)) errors.push(error);
		}
	}
	try {
		const destination = await getOptional(context, [
			'alerts',
			'destinations',
			state.destinationName,
		]);
		if (destination) {
			assertOwnedDestination(context, destination, state);
			if (errors.length) {
				retained = true;
				throw new NodeOperationError(
					context.getNode(),
					'Destination was preserved because an alert could not be safely detached',
				);
			}
			const folders = (await openObserveApiRequest.call(context, {
				apiPathMode: 'v2',
				pathSegments: ['folders', 'alerts'],
			})) as { list?: Array<{ folderId?: string }> };
			if (!Array.isArray(folders.list))
				throw new NodeOperationError(
					context.getNode(),
					'Alert folder reference scan returned a malformed response',
				);
			const discoveredFolderIds = folders.list.map((entry) => {
				if (
					typeof entry !== 'object' ||
					entry === null ||
					typeof entry.folderId !== 'string' ||
					!entry.folderId.trim()
				)
					throw new NodeOperationError(
						context.getNode(),
						'Alert folder reference scan returned a malformed folder entry',
					);
				return entry.folderId.trim();
			});
			const folderIds = [...new Set(['default', ...discoveredFolderIds])];
			let referenced = false;
			for (const folder of folderIds) {
				let exhausted = false;
				for (let pageIndex = 0; pageIndex < 100; pageIndex++) {
					const response = (await openObserveApiRequest.call(context, {
						apiPathMode: 'v2',
						pathSegments: ['alerts'],
						query: { folder, page_size: 100, page_idx: pageIndex },
					})) as { list?: Array<{ id?: string; alert_id?: string }> };
					if (!Array.isArray(response.list))
						throw new NodeOperationError(
							context.getNode(),
							'Alert reference scan returned a malformed response',
						);
					const alerts = response.list;
					for (const listedAlert of alerts) {
						const listedAlertId = listedAlert.id ?? listedAlert.alert_id;
						if (!listedAlertId)
							throw new NodeOperationError(
								context.getNode(),
								`Alert reference scan returned an entry without an ID (fields: ${Object.keys(listedAlert).sort().join(', ')})`,
							);
						const fullAlert = await getAlert(context, listedAlertId, folder);
						if (!Array.isArray(fullAlert.destinations))
							throw new NodeOperationError(
								context.getNode(),
								`Alert ${listedAlertId} returned malformed destinations during reference scan`,
							);
						if (fullAlert.destinations.includes(state.destinationName)) {
							referenced = true;
							break;
						}
					}
					if (alerts.length < 100 || referenced) {
						exhausted = true;
						break;
					}
				}
				if (!exhausted)
					throw new NodeOperationError(
						context.getNode(),
						'Alert reference scan exceeded 100 pages',
					);
				if (referenced) break;
			}
			if (!referenced)
				await openObserveApiRequest.call(context, {
					method: 'DELETE',
					pathSegments: ['alerts', 'destinations', state.destinationName],
					query: { module: 'alert' },
				});
			else retained = true;
			if (!referenced) {
				let absent = false;
				for (let attempt = 0; attempt < 8; attempt++) {
					const listed = await openObserveApiRequest.call(context, {
						pathSegments: ['alerts', 'destinations'],
						query: { module: 'alert' },
					});
					if (!Array.isArray(listed))
						throw new NodeOperationError(
							context.getNode(),
							'Destination deletion check returned a malformed response',
						);
					if (
						!listed.some(
							(entry) =>
								typeof entry === 'object' &&
								entry !== null &&
								(entry as { name?: unknown }).name === state.destinationName,
						)
					) {
						absent = true;
						break;
					}
					await delay(250);
				}
				if (!absent)
					throw new NodeOperationError(
						context.getNode(),
						'Owned trigger destination could not be confirmed deleted',
					);
			}
		}
	} catch (error) {
		errors.push(error);
	}
	try {
		const template = await getOptional(context, ['alerts', 'templates', state.templateName]);
		if (template) {
			assertOwnedTemplate(context, template, state.templateName);
			const destinations = await openObserveApiRequest.call(context, {
				pathSegments: ['alerts', 'destinations'],
				query: { module: 'alert' },
			});
			if (!Array.isArray(destinations))
				throw new NodeOperationError(
					context.getNode(),
					'Destination reference scan returned a malformed response',
				);
			let referenced = false;
			for (const entry of destinations) {
				if (typeof entry !== 'object' || entry === null)
					throw new NodeOperationError(
						context.getNode(),
						'Destination reference scan returned a malformed entry',
					);
				const candidate = entry as { name?: unknown; template?: unknown };
				if (candidate.template !== state.templateName) continue;
				if (typeof candidate.name !== 'string' || !candidate.name)
					throw new NodeOperationError(
						context.getNode(),
						'Destination reference scan returned an entry without a name',
					);
				const currentDestination = await getOptional(context, [
					'alerts',
					'destinations',
					candidate.name,
				]);
				if (currentDestination?.template === state.templateName) {
					referenced = true;
					break;
				}
			}
			if (!referenced)
				await openObserveApiRequest.call(context, {
					method: 'DELETE',
					pathSegments: ['alerts', 'templates', state.templateName],
				});
			else retained = true;
			if (!referenced && (await getOptional(context, ['alerts', 'templates', state.templateName])))
				throw new NodeOperationError(
					context.getNode(),
					'Owned trigger template could not be confirmed deleted',
				);
		}
	} catch (error) {
		errors.push(error);
	}
	if (retained)
		errors.push(
			new NodeOperationError(
				context.getNode(),
				'Owned trigger artifacts remain referenced and were preserved for manual cleanup',
			),
		);
	if (!errors.length) for (const key of Object.keys(state)) delete state[key];
	if (errors.length) {
		const details = errors
			.map((error) => (error instanceof Error ? error.message : 'Unknown cleanup error'))
			.map((message) => (state.secret ? message.split(state.secret).join('[REDACTED]') : message))
			.join('; ');
		throw new NodeOperationError(
			context.getNode(),
			`Trigger cleanup failed in ${errors.length} step(s): ${details}`,
		);
	}
}
