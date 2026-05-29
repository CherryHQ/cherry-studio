import path from 'node:path'

/**
 * Absolute path to the ripgrep binary vendored by `@anthropic-ai/claude-agent-sdk`.
 *
 * Production resolves ripgrep via `getBinaryPath('rg')` (mise shim → cherry.bin),
 * but neither location is populated in unit tests. Tests mock `getBinaryPath` to
 * return this real binary so directory scans still spawn an actual ripgrep.
 */
export function vendoredRipgrepPath(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
  return path.join(
    process.cwd(),
    'node_modules',
    '@anthropic-ai',
    'claude-agent-sdk',
    'vendor',
    'ripgrep',
    `${arch}-${platform}`,
    process.platform === 'win32' ? 'rg.exe' : 'rg'
  )
}
