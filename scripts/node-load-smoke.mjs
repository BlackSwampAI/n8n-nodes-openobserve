import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

const packageRoot = process.argv[2] ? resolve(process.argv[2]) : resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const { OpenObserve } = require(resolve(packageRoot, 'dist/nodes/OpenObserve/OpenObserve.node.js'));
const { OpenObserveTrigger } = require(
	resolve(packageRoot, 'dist/nodes/OpenObserveTrigger/OpenObserveTrigger.node.js'),
);
const { OpenObserveApi } = require(
	resolve(packageRoot, 'dist/credentials/OpenObserveApi.credentials.js'),
);
const action = new OpenObserve();
const trigger = new OpenObserveTrigger();
const credential = new OpenObserveApi();

if (
	action.description.name !== 'openObserve' ||
	trigger.description.name !== 'openObserveTrigger'
) {
	throw new Error('Compiled OpenObserve action or trigger identity is invalid');
}
if (typeof action.execute !== 'function' || typeof trigger.webhook !== 'function') {
	throw new Error('Compiled OpenObserve nodes do not expose their runtime entry points');
}
for (const description of [action.description, trigger.description]) {
	if (
		description.credentials?.[0]?.name !== 'openObserveApi' ||
		!description.credentials[0].required
	) {
		throw new Error('Compiled node is not connected to the required OpenObserve API credential');
	}
}
if (
	credential.name !== 'openObserveApi' ||
	credential.authenticate?.type !== undefined ||
	typeof credential.authenticate !== 'function' ||
	credential.test?.request?.method !== 'GET' ||
	credential.test?.request?.url !== '/api/__n8n_openobserve_credential_test__/streams'
) {
	throw new Error('Compiled OpenObserve credential or harmless credential test is invalid');
}
for (const [directory, description] of [
	['OpenObserve', action.description],
	['OpenObserveTrigger', trigger.description],
]) {
	for (const icon of [description.icon?.light, description.icon?.dark]) {
		if (typeof icon !== 'string' || !icon.startsWith('file:'))
			throw new Error('Invalid icon reference');
		if (!existsSync(resolve(packageRoot, 'dist/nodes', directory, icon.slice(5)))) {
			throw new Error(`Packaged icon is missing: ${icon}`);
		}
	}
}
console.log(
	'Compiled OpenObserve action, trigger, credential, and credential test loaded successfully',
);
