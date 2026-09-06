import { execFileSync } from 'node:child_process';

const version = execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim();
const [major = 0, minor = 0, patch = 0] = version.split('.').map(Number);
const supported = major > 11 || (major === 11 && (minor > 5 || (minor === 5 && patch >= 1)));
if (!supported) {
	console.error('npm 11.5.1 or newer is required for Trusted Publishing');
	process.exit(1);
}
console.log(`npm ${version} satisfies the Trusted Publishing minimum`);
