/**
 * Parse the current version from `openclaw --version` output.
 * Example input: "OpenClaw 2026.3.9 (fe96034)"
 */
export function parseCurrentVersion(versionOutput: string): string | null {
  const match = versionOutput.match(/OpenClaw\s+([\d.]+)/i)
  return match?.[1] ?? null
}

/**
 * Parse the update status from `openclaw update status` output.
 * Returns the latest version string if an update is available, otherwise null.
 * Example input: "Update available (npm 2026.3.11). Run: openclaw update"
 */
export function parseUpdateStatus(statusOutput: string): string | null {
  const match = statusOutput.match(/Update available.*?(\d[\d.]+)/i)
  return match?.[1] ?? null
}
