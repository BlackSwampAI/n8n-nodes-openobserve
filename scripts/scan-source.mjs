import { resolve } from 'node:path';
import {
	SOURCE_FILE_PATTERNS,
	analyzePackage,
} from '@n8n/scan-community-package/scanner/scanner.mjs';

const root = resolve(import.meta.dirname, '..');

async function requirePassingScan(label, patterns) {
	const result = await analyzePackage(root, patterns);
	if (!result.passed) {
		console.error(`${label} failed: ${result.message}`);
		if (result.details) console.error(result.details);
		process.exit(1);
	}
	console.log(`${label} passed`);
}

await requirePassingScan('Official scanner source preflight', SOURCE_FILE_PATTERNS);
await requirePassingScan('Official scanner built-package preflight', [
	'dist/**/*.js',
	'package.json',
]);
