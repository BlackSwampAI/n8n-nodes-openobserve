// Vitest runs the suite; Node's strict assertions retain the existing metadata checks.
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import assert from 'node:assert/strict';
// Repository-level tests intentionally inspect local fixture and metadata files.
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { access, readFile } from 'node:fs/promises';
import { test } from 'vitest';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const nodeSource = await readFile(
	new URL('../nodes/OpenObserve/OpenObserve.node.ts', import.meta.url),
	'utf8',
);

test('package identity and runtime boundary are frozen', () => {
	assert.equal(packageJson.name, '@blackswampai/n8n-nodes-openobserve');
	assert.equal(
		packageJson.repository.url,
		'https://github.com/BlackSwampAI/n8n-nodes-openobserve.git',
	);
	assert.equal(packageJson.author.email, 'christopherjnelson@proton.me');
	assert.equal(packageJson.dependencies, undefined);
	assert.equal(packageJson.peerDependencies['n8n-workflow'], '*');
});

test('only the inert OpenObserve shell and API credential are registered', () => {
	assert.deepEqual(packageJson.n8n.nodes, ['dist/nodes/OpenObserve/OpenObserve.node.js']);
	assert.deepEqual(packageJson.n8n.credentials, ['dist/credentials/OpenObserveApi.credentials.js']);
});

test('node metadata keeps the shell visible and tool-compatible', async () => {
	assert.match(nodeSource, /icon:\s*\{\s*light:\s*'file:openobserve\.svg'/);
	assert.match(nodeSource, /dark:\s*'file:openobserve\.dark\.svg'/);
	assert.match(nodeSource, /subtitle:\s*'OpenObserve API development scaffold'/);
	assert.match(nodeSource, /usableAsTool:\s*true/);
	assert.match(
		nodeSource,
		/credentials:\s*\[\{\s*name:\s*'openObserveApi',\s*required:\s*true\s*\}\]/,
	);
	await Promise.all([
		access(new URL('../nodes/OpenObserve/openobserve.svg', import.meta.url)),
		access(new URL('../nodes/OpenObserve/openobserve.dark.svg', import.meta.url)),
	]);
});
