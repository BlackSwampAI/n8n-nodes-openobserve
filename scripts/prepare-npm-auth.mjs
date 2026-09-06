import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function prepareNpmAuth(environment = process.env) {
	if (environment.NODE_AUTH_TOKEN) return 'token';
	const userConfig = environment.NPM_CONFIG_USERCONFIG;
	if (!userConfig || !existsSync(userConfig)) return 'oidc';
	const contents = readFileSync(userConfig, 'utf8');
	const lines = contents.split(/(?<=\n)/);
	const filtered = lines.filter(
		(line) =>
			!/^\s*\/\/registry\.npmjs\.org\/:_authToken=\$\{NODE_AUTH_TOKEN\}\s*(?:\r?\n)?$/.test(line),
	);
	if (filtered.length !== lines.length) writeFileSync(userConfig, filtered.join(''));
	return 'oidc';
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	const mode = prepareNpmAuth();
	console.log(`npm authentication prepared for ${mode === 'token' ? 'token bootstrap' : 'OIDC'}`);
}
