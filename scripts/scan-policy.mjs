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
		/^Reason: Analysis failed: Request failed with status code 404\s*$/m.test(output) ||
		output.includes(
			"Could not fetch the source repository recorded in the package's npm provenance (Request failed with status code 404)",
		)
	);
}
