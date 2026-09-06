import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prepareNpmAuth } from './prepare-npm-auth.mjs';

const root = resolve(import.meta.dirname, '..');
prepareNpmAuth(process.env);
const { name, version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const packageSpec = `${name}@${version}`;
const attempts = 6;
for (let attempt = 1; attempt <= attempts; attempt += 1) {
	const result = spawnSync('npx', ['--yes', '@n8n/scan-community-package@0.34.0', packageSpec], {
		cwd: root,
		encoding: 'utf8',
	});
	const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
	process.stdout.write(output);
	if (output.includes(`Package ${packageSpec} has passed all security checks`)) process.exit(0);
	if (attempt < attempts) {
		console.error(
			`Published package scan not successful yet (attempt ${attempt}/${attempts}); retrying in 10 seconds.`,
		);
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 10_000));
	}
}
console.error(`Official scanner did not explicitly report success for ${packageSpec}.`);
process.exit(1);
