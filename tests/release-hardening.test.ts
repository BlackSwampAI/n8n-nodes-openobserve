// Release tooling tests intentionally use Node built-ins and local temporary files.
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { tmpdir } from 'node:os';
// eslint-disable-next-line @n8n/community-nodes/no-restricted-imports
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { prepareNpmAuth } from '../scripts/prepare-npm-auth.mjs';
import {
	isDeterministicSecurityFailure,
	isLikelyPropagationFailure,
} from '../scripts/scan-policy.mjs';

const temporaryDirectories: string[] = [];
afterEach(() => {
	for (const directory of temporaryDirectories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

describe('npm authentication preparation', () => {
	it('preserves setup-node configuration when the bootstrap token exists', () => {
		const directory = mkdtempSync(join(tmpdir(), 'openobserve-auth-test-'));
		temporaryDirectories.push(directory);
		const config = join(directory, '.npmrc');
		const contents =
			'//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\nregistry=https://registry.npmjs.org/\n';
		writeFileSync(config, contents);
		expect(prepareNpmAuth({ NODE_AUTH_TOKEN: 'present', NPM_CONFIG_USERCONFIG: config })).toBe(
			'token',
		);
		expect(readFileSync(config, 'utf8')).toBe(contents);
	});

	it('removes only the setup-node token line for tokenless OIDC', () => {
		const directory = mkdtempSync(join(tmpdir(), 'openobserve-auth-test-'));
		temporaryDirectories.push(directory);
		const config = join(directory, '.npmrc');
		writeFileSync(
			config,
			'registry=https://registry.npmjs.org/\n//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\nprovenance=true\n',
		);
		expect(prepareNpmAuth({ NODE_AUTH_TOKEN: '', NPM_CONFIG_USERCONFIG: config })).toBe('oidc');
		expect(readFileSync(config, 'utf8')).toBe(
			'registry=https://registry.npmjs.org/\nprovenance=true\n',
		);
	});
});

describe('published scanner retry policy', () => {
	const packageSpec = '@blackswampai/n8n-nodes-openobserve@0.1.3';

	it('does not retry deterministic scanner violations', () => {
		const output = `❌ Package ${packageSpec} has failed security checks\nReason: ESLint violations found\n\nDetails:\n/source/file.ts\n  404:3 error Use NodeOperationError`;
		expect(isDeterministicSecurityFailure(output, packageSpec)).toBe(true);
		expect(isLikelyPropagationFailure(output, packageSpec)).toBe(false);
	});

	it('retries the observed first-publication analysis 404', () => {
		const output = `❌ Package ${packageSpec} has failed security checks\nReason: Analysis failed: Request failed with status code 404`;
		expect(isDeterministicSecurityFailure(output, packageSpec)).toBe(false);
		expect(isLikelyPropagationFailure(output, packageSpec)).toBe(true);
	});

	it('retries the exact post-publish version metadata absence', () => {
		const output = `Checking provenance for ${packageSpec}...❌ Provenance check failed for ${packageSpec}\n❌ Package ${packageSpec} has failed security checks\nReason: No package metadata found for version 0.1.3`;
		expect(isDeterministicSecurityFailure(output, packageSpec)).toBe(false);
		expect(isLikelyPropagationFailure(output, packageSpec)).toBe(true);
	});

	it('retries the exact transient provenance source-repository 404', () => {
		const output = `❌ Package ${packageSpec} has failed security checks\nReason: Could not fetch the source repository recorded in the package's npm provenance (Request failed with status code 404)`;
		expect(isDeterministicSecurityFailure(output, packageSpec)).toBe(false);
		expect(isLikelyPropagationFailure(output, packageSpec)).toBe(true);
	});

	it('does not retry metadata absence for a different version', () => {
		const output = `Package ${packageSpec} has failed security checks\nReason: No package metadata found for version 0.1.1`;
		expect(isLikelyPropagationFailure(output, packageSpec)).toBe(false);
		expect(isDeterministicSecurityFailure(output, packageSpec)).toBe(true);
	});

	it('does not retry unrelated metadata failures', () => {
		for (const reason of [
			'Reason: Package metadata is invalid for version 0.1.3',
			'Reason: No package metadata found',
			'Reason: No package metadata found for package openobserve',
			"Reason: Could not fetch the source repository recorded in the package's npm provenance (Request failed with status code 403)",
			'Reason: Request failed with status code 429',
			'Reason: ETIMEDOUT while fetching source',
		]) {
			const output = `Package ${packageSpec} has failed security checks\n${reason}`;
			expect(isLikelyPropagationFailure(output, packageSpec)).toBe(false);
			expect(isDeterministicSecurityFailure(output, packageSpec)).toBe(true);
		}
	});
});
