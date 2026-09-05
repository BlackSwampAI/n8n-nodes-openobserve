// Vitest runs the suite; Node's strict assertions retain the existing metadata checks.
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import assert from 'node:assert/strict';
// Repository-level tests intentionally inspect local fixture and metadata files.
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { access, readFile } from 'node:fs/promises';
import { expect, it, test } from 'vitest';
import { OpenObserve } from '../nodes/OpenObserve/OpenObserve.node';

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const nodeSource = await readFile(
	new URL('../nodes/OpenObserve/OpenObserve.node.ts', import.meta.url),
	'utf8',
);
const publishWorkflow = await readFile(
	new URL('../.github/workflows/publish.yml', import.meta.url),
	'utf8',
);
const ciWorkflow = await readFile(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

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

test('the OpenObserve action and trigger nodes and API credential are registered', () => {
	assert.deepEqual(packageJson.n8n.nodes, [
		'dist/nodes/OpenObserve/OpenObserve.node.js',
		'dist/nodes/OpenObserveTrigger/OpenObserveTrigger.node.js',
	]);
	assert.deepEqual(packageJson.n8n.credentials, ['dist/credentials/OpenObserveApi.credentials.js']);
});

test('node metadata keeps the shell visible and tool-compatible', async () => {
	assert.match(nodeSource, /icon:\s*\{\s*light:\s*'file:openobserve\.svg'/);
	assert.match(nodeSource, /dark:\s*'file:openobserve\.dark\.svg'/);
	assert.match(nodeSource, /subtitle:\s*'=\{\{\$parameter\["resource"\]/);
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

test('release workflows are least-privilege and run complete frozen gates', () => {
	assert.match(ciWorkflow, /permissions:\s*\n\s+contents: read/);
	assert.match(publishWorkflow, /id-token: write/);
	assert.match(publishWorkflow, /contents: read/);
	assert.match(publishWorkflow, /node-version: '24'/);
	for (const command of [
		'npm ci',
		'npm run release:check',
		'npm run format:check',
		'npm run lint',
		'npm run typecheck',
		'npm test',
		'npm run build',
		'npm run package:check',
		'npm run release',
	])
		assert.match(publishWorkflow, new RegExp(command.split(' ').join('\\s+')));
});

function optionValues(options: readonly unknown[] | undefined): unknown[] {
	return (options ?? []).flatMap((option) =>
		typeof option === 'object' && option !== null && 'value' in option
			? [(option as { value: unknown }).value]
			: [],
	);
}

test('the advertised v0.1 resource and operation matrix is complete', () => {
	const description = new OpenObserve().description;
	const resources = description.properties.find((property) => property.name === 'resource');
	assert.deepEqual(optionValues(resources?.options), [
		'alert',
		'alertDestination',
		'alertTemplate',
		'dashboard',
		'function',
		'log',
		'metric',
		'pipeline',
		'search',
		'stream',
		'trace',
	]);
	const expected: Record<string, string[]> = {
		alert: [
			'clone',
			'create',
			'delete',
			'disable',
			'enable',
			'export',
			'get',
			'getHistory',
			'getMany',
			'trigger',
			'update',
		],
		alertDestination: ['create', 'delete', 'get', 'getMany', 'update'],
		alertTemplate: ['create', 'delete', 'get', 'getMany', 'getPrebuilt', 'update'],
		dashboard: ['create', 'delete', 'get', 'getMany', 'update'],
		function: ['create', 'delete', 'getDependencies', 'getMany', 'update', 'validate'],
		log: ['ingest', 'ingestMany'],
		metric: [
			'findSeries',
			'getLabelValues',
			'getLabels',
			'getMetadata',
			'instantQuery',
			'rangeQuery',
		],
		pipeline: ['create', 'delete', 'disable', 'enable', 'get', 'getHistory', 'getMany', 'update'],
		search: ['getFieldValues', 'query', 'searchAround'],
		stream: ['delete', 'deleteFields', 'getMany', 'getSchema', 'updateSettings'],
		trace: ['getDag', 'getLatest'],
	};
	for (const [resource, operations] of Object.entries(expected)) {
		const property = description.properties.find(
			(candidate) =>
				candidate.name === 'operation' &&
				candidate.displayOptions?.show?.resource?.includes(resource),
		);
		assert.deepEqual(optionValues(property?.options), operations, resource);
	}
	expect(Object.values(expected).flat()).toHaveLength(59);
});

it('keeps minimum-configuration safety metadata on side-effecting operations', () => {
	const properties = new OpenObserve().description.properties;
	const find = (resource: string, name: string, operation: string) =>
		properties.find(
			(property) =>
				property.name === name &&
				property.displayOptions?.show?.resource?.includes(resource) &&
				property.displayOptions.show.operation?.includes(operation),
		);

	expect(find('alert', 'destinations', 'create')).toMatchObject({
		type: 'multiOptions',
		required: true,
	});
	expect(find('alert', 'frequency', 'create')?.displayOptions?.show?.alertType).toEqual([
		'scheduled',
	]);
	expect(find('alert', 'period', 'create')?.displayOptions?.show?.alertType).toEqual(['scheduled']);
	for (const resource of [
		'stream',
		'function',
		'dashboard',
		'alertTemplate',
		'alertDestination',
		'alert',
		'pipeline',
	]) {
		expect(find(resource, 'confirmDestructive', 'delete'), resource).toBeDefined();
	}
	expect(find('alert', 'confirmTrigger', 'trigger')).toBeDefined();
});

it('keeps representative editor selections focused and hides unrelated dynamic locators', () => {
	const properties = new OpenObserve().description.properties;
	for (const property of properties) {
		expect(property).not.toHaveProperty('show');
	}
	const visibleNames = (resource: string, operation: string) =>
		properties
			.filter((property) => {
				const show = property.displayOptions?.show;
				if (!show) return property.name === 'resource';
				return Object.entries(show).every(([name, accepted]) => {
					const value =
						name === 'resource' ? resource : name === 'operation' ? operation : undefined;
					return value === undefined || (accepted as unknown[]).includes(value);
				});
			})
			.map((property) => property.name);

	expect(visibleNames('stream', 'getMany')).toEqual(
		expect.arrayContaining([
			'resource',
			'operation',
			'streamType',
			'returnAll',
			'limit',
			'keyword',
			'sort',
		]),
	);
	expect(visibleNames('stream', 'getMany')).not.toEqual(
		expect.arrayContaining(['streamName', 'fieldsJson', 'settingsJson']),
	);
	expect(visibleNames('metric', 'instantQuery')).toEqual(
		expect.arrayContaining([
			'resource',
			'operation',
			'promql',
			'queryTime',
			'queryTimeout',
			'rawResponse',
		]),
	);
	expect(visibleNames('metric', 'instantQuery')).not.toEqual(
		expect.arrayContaining(['metricJson', 'streamName']),
	);
	for (const [resource, operation] of [
		['alert', 'create'],
		['pipeline', 'create'],
	] as const) {
		const visible = properties.filter((property) =>
			visibleNames(resource, operation).includes(property.name),
		);
		const hiddenDynamic = properties.filter(
			(property) =>
				!visible.includes(property) &&
				property.type === 'resourceLocator' &&
				property.modes?.some((mode) => mode.typeOptions?.searchListMethod),
		);
		expect(hiddenDynamic.length).toBeGreaterThan(0);
		expect(visible.map((property) => property.name)).toContain('operation');
	}
});
