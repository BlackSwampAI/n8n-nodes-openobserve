import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));

test('package identity and runtime boundary are frozen', () => {
	assert.equal(packageJson.name, '@blackswampai/n8n-nodes-openobserve');
	assert.equal(
		packageJson.repository.url,
		'https://github.com/BlackSwampAI/n8n-nodes-openobserve.git',
	);
	assert.equal(packageJson.dependencies, undefined);
	assert.equal(packageJson.peerDependencies['n8n-workflow'], '*');
});

test('only the inert OpenObserve shell is registered in Batch 0', () => {
	assert.deepEqual(packageJson.n8n.nodes, ['dist/OpenObserve.node.js']);
	assert.equal(packageJson.n8n.credentials, undefined);
});
