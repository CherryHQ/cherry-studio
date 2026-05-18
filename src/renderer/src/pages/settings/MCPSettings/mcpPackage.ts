type McpPackageVersionManifest = { dxt_version: string } | { manifest_version: string }

export function resolveMcpPackagePathPlaceholders(value: string, extractDir: string): string {
  return value.replace(/\$\{__dirname\}/g, extractDir)
}

export function resolveMcpPackageVersion(manifest: McpPackageVersionManifest): string {
  return 'dxt_version' in manifest ? manifest.dxt_version : manifest.manifest_version
}

export function resolveMcpPackageIconUrl(icon: string | undefined, extractDir: string): string | undefined {
  if (!icon) {
    return undefined
  }
  return /^https:\/\//i.test(icon) ? icon : `file://${extractDir}/${icon}`
}
