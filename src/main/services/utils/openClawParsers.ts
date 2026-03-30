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
 * Returns the latest version string if a **binary** update is available, otherwise null.
 *
 * Cherry Studio installs OpenClaw as a standalone binary, so we only care about
 * binary-channel updates. npm/pkg-channel updates are ignored because they
 * require a different upgrade path (`npm update -g`).
 *
 * The table output contains a row like:
 *   │ Update   │ available · binary · 2026.3.12 │
 * And a summary line like:
 *   Update available (binary 2026.3.12). Run: openclaw update
 */
export function parseUpdateStatus(statusOutput: string): string | null {
  // Match binary-channel update from table row: "available · binary · <version>"
  const tableMatch = statusOutput.match(/available\s*·\s*binary\s*·?\s*([\d.]+)/i)
  if (tableMatch) return tableMatch[1]

  // Match binary-channel update from summary line: "Update available (binary <version>)"
  const summaryMatch = statusOutput.match(/Update available\s*\(binary\s+([\d.]+)\)/i)
  if (summaryMatch) return summaryMatch[1]

  return null
}
