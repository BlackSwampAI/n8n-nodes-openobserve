export function isDeterministicSecurityFailure(output, packageSpec) {
	if (/ESLint violations found|malware|prohibited dependency/i.test(output)) return true;
	return (
		output.includes(`Package ${packageSpec} has failed security checks`) &&
		!isLikelyPropagationFailure(output, packageSpec)
	);
}

export function isLikelyPropagationFailure(output, packageSpec) {
	const expectedVersion = packageSpec.slice(packageSpec.lastIndexOf('@') + 1);
	const missingMetadata = /^Reason: No package metadata found for version (\S+)\s*$/m.exec(output);
	return (
		(missingMetadata !== null && missingMetadata[1] === expectedVersion) ||
		/Analysis failed:.*(?:status code 404|E404|not found)|\b(?:E404|429|ETIMEDOUT|ECONNRESET|ENOTFOUND)\b|HTTP 404|404 Not Found|not yet available|registry propagation|failed to fetch|failed to download|provenance.*(?:missing|unavailable)/is.test(
			output,
		)
	);
}
