import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const failures = [];

function fail(message) {
	failures.push(message);
}

function read(path) {
	return readFileSync(resolve(root, path), 'utf8');
}

function hasPlaceholder(value) {
	return typeof value === 'string' && /<\.\.\.|TODO|CHANGEME/i.test(value);
}

const packageJson = JSON.parse(read('package.json'));
const publishWorkflow = read('.github/workflows/publish.yml');
const readme = read('README.md');

if (!/^n8n-nodes-[a-z0-9][a-z0-9._-]*$/.test(packageJson.name ?? '')) {
	fail('package.json name must be the final lowercase n8n-nodes-* package name');
}

for (const [label, value] of [
	['name', packageJson.name],
	['description', packageJson.description],
	['homepage', packageJson.homepage],
	['repository.url', packageJson.repository?.url],
	['author.name', packageJson.author?.name],
	['author.email', packageJson.author?.email],
]) {
	if (!value || hasPlaceholder(value)) fail(`package.json ${label} is missing or still a placeholder`);
}

if (packageJson.private === true) fail('package.json must not be private');
if (packageJson.license !== 'MIT') fail('package.json license must be MIT for n8n verification');
if (!packageJson.keywords?.includes('n8n-community-node-package')) {
	fail('package.json keywords must contain n8n-community-node-package');
}
if (Object.keys(packageJson.dependencies ?? {}).length > 0) {
	fail('runtime dependencies require explicit n8n verification review; remove or justify them');
}
if (packageJson.peerDependencies?.['n8n-workflow'] !== '*') {
	fail('n8n-workflow must remain a host-provided peer dependency');
}
if (packageJson.n8n?.strict !== true) fail('package.json n8n.strict must be true');
if (!packageJson.n8n?.nodes?.length) fail('package.json n8n.nodes must register at least one built node');
if (packageJson.publishConfig?.access !== 'public') fail('publishConfig.access must be public');
if (packageJson.engines?.node !== '>=22.22.0') fail('engines.node must match the current >=22.22.0 baseline');
if (packageJson.scripts?.release !== 'n8n-node release') fail('release script must use n8n-node release');
if (packageJson.scripts?.prepublishOnly !== 'n8n-node prerelease') {
	fail('prepublishOnly must use the n8n-node prerelease guard');
}

if (!publishWorkflow.includes("- 'v*.*.*'")) fail('publish workflow must trigger on v-prefixed version tags');
if (!/id-token:\s*write/.test(publishWorkflow)) fail('publish workflow needs id-token: write');
if (!publishWorkflow.includes('npm run release')) fail('publish workflow must run npm run release');
if (!publishWorkflow.includes('secrets.NPM_TOKEN')) {
	fail('publish workflow must retain the first-publication NPM_TOKEN fallback');
}

for (const heading of ['## Installation', '## Compatibility', '## Credentials', '## Operations', '## License']) {
	if (!readme.includes(heading)) fail(`README is missing ${heading}`);
}
if (hasPlaceholder(readme)) fail('README still contains a placeholder');

for (const path of ['LICENSE.md', 'CHANGELOG.md', 'RELEASING.md']) {
	if (!existsSync(resolve(root, path))) fail(`${path} is required`);
}

try {
	const origin = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim();
	const normalizedOrigin = origin
		.replace(/^git@github\.com:/, 'https://github.com/')
		.replace(/\.git$/, '');
	const normalizedRepository = String(packageJson.repository?.url ?? '')
		.replace(/^git\+/, '')
		.replace(/\.git$/, '');
	if (normalizedOrigin !== normalizedRepository) {
		fail(`repository.url must match origin exactly (${normalizedOrigin})`);
	}
} catch {
	fail('unable to verify the GitHub origin');
}

if (failures.length) {
	console.error('Release audit failed:\n');
	for (const failure of failures) console.error(`- ${failure}`);
	process.exit(1);
}

console.log(`Release audit passed for ${packageJson.name}@${packageJson.version}`);
