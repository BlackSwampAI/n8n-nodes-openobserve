import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const [pack] = JSON.parse(
	execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: root, encoding: 'utf8' }),
);
const files = pack.files.map(({ path }) => path).sort();
const required = [
	'LICENSE.md',
	'README.md',
	'package.json',
	'dist/credentials/OpenObserveApi.credentials.js',
	'dist/nodes/OpenObserve/OpenObserve.node.js',
	'dist/nodes/OpenObserve/OpenObserve.node.json',
	'dist/nodes/OpenObserve/openobserve.svg',
	'dist/nodes/OpenObserve/openobserve.dark.svg',
	'dist/nodes/OpenObserveTrigger/OpenObserveTrigger.node.js',
	'dist/nodes/OpenObserveTrigger/OpenObserveTrigger.node.json',
	'dist/nodes/OpenObserveTrigger/openobserve.svg',
	'dist/nodes/OpenObserveTrigger/openobserve.dark.svg',
];
const missing = required.filter((path) => !files.includes(path));
const unexpected = files.filter(
	(path) =>
		!['LICENSE.md', 'README.md', 'package.json'].includes(path) && !path.startsWith('dist/'),
);
const alternateReadmes = files.filter(
	(path) => /(?:^|\/)readme(?:\.[^/]*)?$/i.test(path) && path !== 'README.md',
);
const iconHash = '888491dc3e61cb0b2dd069d844c92ea0098197884176e2abb9db3570d764022f';
for (const path of [
	'nodes/OpenObserve/openobserve.svg',
	'nodes/OpenObserve/openobserve.dark.svg',
	'nodes/OpenObserveTrigger/openobserve.svg',
	'nodes/OpenObserveTrigger/openobserve.dark.svg',
	'dist/nodes/OpenObserve/openobserve.svg',
	'dist/nodes/OpenObserve/openobserve.dark.svg',
	'dist/nodes/OpenObserveTrigger/openobserve.svg',
	'dist/nodes/OpenObserveTrigger/openobserve.dark.svg',
]) {
	const actual = createHash('sha256')
		.update(readFileSync(resolve(root, path)))
		.digest('hex');
	if (actual !== iconHash) throw new Error(`Official OpenObserve icon hash changed: ${path}`);
}
if (missing.length || unexpected.length || alternateReadmes.length) {
	throw new Error(
		[
			'Packed artifact boundary failed.',
			missing.length ? `Missing: ${missing.join(', ')}` : '',
			unexpected.length ? `Unexpected: ${unexpected.join(', ')}` : '',
			alternateReadmes.length ? `Alternate READMEs: ${alternateReadmes.join(', ')}` : '',
		]
			.filter(Boolean)
			.join('\n'),
	);
}
const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
for (const registered of [...packageJson.n8n.nodes, ...packageJson.n8n.credentials]) {
	if (!files.includes(registered))
		throw new Error(`Registered artifact is absent from package: ${registered}`);
}
console.log(`Package boundary passed (${files.length} intended files, ${pack.size} bytes packed)`);
