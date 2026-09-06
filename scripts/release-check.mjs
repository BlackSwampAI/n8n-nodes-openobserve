import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
const ciWorkflow = read('.github/workflows/ci.yml');
const readme = read('README.md');
const credentialSource = read('credentials/OpenObserveApi.credentials.ts');
const sourceScannerSource = read('scripts/scan-source.mjs');
const scannerSource = read('scripts/scan-published.mjs');
const templateMarkerPath = '.blackswamp/template.json';
let templateMarker;
if (!existsSync(resolve(root, templateMarkerPath))) {
	fail(`${templateMarkerPath} is required`);
} else {
	try {
		templateMarker = JSON.parse(read(templateMarkerPath));
	} catch {
		fail(`${templateMarkerPath} must contain valid JSON`);
	}
}
const finalDocumentation = ['docs/api-matrix.md', 'docs/testing.md', 'docs/branding.md'];
const adoptedBaselineArtifacts = [
	'.github/pull_request_template.md',
	'docs/BATCH_HANDOFF_TEMPLATE.md',
	'docs/TEMPLATE_MIGRATIONS.md',
];
const templateDocumentation = [
	'docs/API_MATRIX_TEMPLATE.md',
	'docs/TESTING_TEMPLATE.md',
	'docs/BRANDING_TEMPLATE.md',
];
const iconHash = '888491dc3e61cb0b2dd069d844c92ea0098197884176e2abb9db3570d764022f';
for (const path of [
	'nodes/OpenObserve/openobserve.svg',
	'nodes/OpenObserve/openobserve.dark.svg',
	'nodes/OpenObserveTrigger/openobserve.svg',
	'nodes/OpenObserveTrigger/openobserve.dark.svg',
]) {
	const actual = createHash('sha256')
		.update(readFileSync(resolve(root, path)))
		.digest('hex');
	if (actual !== iconHash) fail(`official OpenObserve icon hash changed: ${path}`);
}

if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?n8n-nodes-[a-z0-9][a-z0-9._-]*$/.test(packageJson.name ?? '')) {
	fail('package.json name must be a lowercase n8n-nodes-* package, optionally npm-scoped');
}

for (const [label, value] of [
	['name', packageJson.name],
	['description', packageJson.description],
	['homepage', packageJson.homepage],
	['repository.url', packageJson.repository?.url],
	['author.name', packageJson.author?.name],
]) {
	if (!value || hasPlaceholder(value))
		fail(`package.json ${label} is missing or still a placeholder`);
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
if (!packageJson.n8n?.nodes?.length)
	fail('package.json n8n.nodes must register at least one built node');
if (packageJson.publishConfig?.access !== 'public') fail('publishConfig.access must be public');
if (packageJson.engines?.node !== '>=22.22.0')
	fail('engines.node must match the current >=22.22.0 baseline');
if (packageJson.packageManager !== 'npm@11.19.0') fail('packageManager must pin npm@11.19.0');
if (packageJson.devDependencies?.['@n8n/node-cli'] !== '0.46.4')
	fail('@n8n/node-cli must match the reviewed 0.46.4 release baseline');
if (packageJson.author?.name !== 'Christopher J. Nelson')
	fail('package author must match the Black Swamp AI owner identity');
if (packageJson.bugs?.url !== 'https://github.com/BlackSwampAI/n8n-nodes-openobserve/issues')
	fail('package bugs URL must point to the project issue tracker');
if (packageJson.scripts?.release !== 'n8n-node release')
	fail('release script must use n8n-node release');
if (packageJson.scripts?.prepublishOnly !== 'n8n-node prerelease') {
	fail('prepublishOnly must use the n8n-node prerelease guard');
}
for (const script of [
	'package:check',
	'smoke:load',
	'smoke:install',
	'scan:source',
	'scan:published',
]) {
	if (!packageJson.scripts?.[script]) fail(`package.json must define ${script}`);
}
if (packageJson.devDependencies?.['@n8n/scan-community-package'] !== '0.34.0') {
	fail('official community-package scanner must remain pinned to 0.34.0');
}
if (
	!sourceScannerSource.includes('SOURCE_FILE_PATTERNS') ||
	!sourceScannerSource.includes("'dist/**/*.js'") ||
	!sourceScannerSource.includes("'package.json'")
) {
	fail('scanner preflight must inspect official source patterns and built package artifacts');
}
for (const path of ['scripts/prepare-npm-auth.mjs', 'scripts/verify-npm-version.mjs']) {
	if (!existsSync(resolve(root, path))) fail(`${path} is required`);
}
if (!scannerSource.includes('prepareNpmAuth(process.env)')) {
	fail('published scanner must remove a stale setup-node token placeholder before invoking npx');
}
if (
	!credentialSource.includes('test: ICredentialTestRequest') ||
	!credentialSource.includes("method: 'GET'") ||
	!credentialSource.includes('CREDENTIAL_TEST_PATH')
) {
	fail('OpenObserve API credential must retain its harmless authenticated GET test');
}

if (process.env.GITHUB_REF_TYPE === 'tag') {
	const expectedTag = `v${packageJson.version}`;
	if (process.env.GITHUB_REF_NAME !== expectedTag) {
		fail(`release tag must exactly match package version (${expectedTag})`);
	}
}

if (!publishWorkflow.includes("- 'v*.*.*'"))
	fail('publish workflow must trigger on v-prefixed version tags');
if (!/timeout-minutes:\s*20/.test(ciWorkflow)) fail('CI must have a 20-minute job timeout');
if (!/timeout-minutes:\s*30/.test(publishWorkflow))
	fail('publish workflow must have a 30-minute job timeout');
if (!/id-token:\s*write/.test(publishWorkflow)) fail('publish workflow needs id-token: write');
if (!publishWorkflow.includes('npm run release')) fail('publish workflow must run npm run release');
if (publishWorkflow.includes('secrets.NPM_TOKEN'))
	fail('established package publishing must use Trusted Publisher OIDC without NPM_TOKEN');
for (const command of [
	'npm ci',
	'npm run format:check',
	'npm run lint',
	'npm run typecheck',
	'npm test',
	'npm run build',
	'npm run scan:source',
	'npm run package:check',
	'npm run smoke:load',
	'npm run smoke:install',
]) {
	if (!publishWorkflow.includes(command)) fail(`publish workflow must run ${command}`);
}
if (!/contents:\s*read/.test(publishWorkflow) || !/contents:\s*read/.test(ciWorkflow)) {
	fail('CI and publish workflows must use contents: read');
}
if (!publishWorkflow.includes("node-version: '24'")) {
	fail('publish workflow must use Node.js 24');
}
for (const [name, workflow] of [
	['CI', ciWorkflow],
	['publish', publishWorkflow],
]) {
	const npmPin = workflow.indexOf('npm install --global npm@11.19.0');
	const frozenInstall = workflow.indexOf('npm ci');
	if (npmPin < 0 || frozenInstall < 0 || npmPin > frozenInstall) {
		fail(`${name} workflow must install npm 11.19.0 before npm ci`);
	}
}
if (!publishWorkflow.includes('npm run scan:published')) {
	fail('publish workflow must verify the published package with the official scanner');
}
for (const [name, workflow] of [
	['CI', ciWorkflow],
	['publish', publishWorkflow],
]) {
	const build = workflow.indexOf('npm run build');
	const scan = workflow.indexOf('npm run scan:source');
	const pack = workflow.indexOf('npm run package:check');
	if (build < 0 || scan < build || pack < scan) {
		fail(`${name} workflow must scan source and built artifacts after build and before packaging`);
	}
}
for (const command of [
	'node scripts/verify-npm-version.mjs',
	'node scripts/prepare-npm-auth.mjs',
]) {
	if (!publishWorkflow.includes(command)) fail(`publish workflow must run ${command}`);
}

for (const heading of [
	'## Installation',
	'## Compatibility',
	'## Credentials',
	'## Operations',
	'## License',
]) {
	if (!readme.includes(heading)) fail(`README is missing ${heading}`);
}
if (hasPlaceholder(readme)) fail('README still contains a placeholder');

if (
	templateMarker !== undefined &&
	(templateMarker?.schemaVersion !== 1 ||
		templateMarker?.templateVersion !== '2.0.0' ||
		templateMarker?.sourceRepository !==
			'https://github.com/christopherjnelson/n8n-community-node-template')
) {
	fail(`${templateMarkerPath} must identify the adopted canonical Template v2 baseline`);
}
for (const path of adoptedBaselineArtifacts) {
	if (!existsSync(resolve(root, path))) fail(`${path} is required`);
}
for (const path of finalDocumentation) {
	if (!existsSync(resolve(root, path))) {
		fail(`${path} is required`);
		continue;
	}
	if (/<[A-Z][A-Z0-9_-]*(?: [A-Z0-9_-]+)*>/.test(read(path))) {
		fail(`${path} contains an unresolved uppercase template placeholder`);
	}
}
for (const path of templateDocumentation) {
	if (existsSync(resolve(root, path))) fail(`${path} must not remain in a generated repository`);
}
for (const [path, content] of [
	['README.md', readme],
	['RELEASING.md', read('RELEASING.md')],
	['docs/testing.md', read('docs/testing.md')],
]) {
	if (
		/release candidate|has not been published|not yet published|unpublished package/i.test(content)
	) {
		fail(`${path} contains stale pre-release wording`);
	}
}

for (const path of ['LICENSE.md', 'CHANGELOG.md', 'RELEASING.md']) {
	if (!existsSync(resolve(root, path))) fail(`${path} is required`);
}

try {
	let origin;
	try {
		origin = execFileSync('git', ['remote', 'get-url', 'origin'], {
			cwd: root,
			encoding: 'utf8',
		}).trim();
	} catch (error) {
		// Some restricted build sandboxes return stdout but deny spawnSync completion.
		const stdout = error && typeof error === 'object' && 'stdout' in error ? error.stdout : '';
		if (typeof stdout !== 'string' || !stdout.trim()) throw error;
		origin = stdout.trim();
	}
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
