import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

const ripgrepExecutable = process.platform === 'win32' ? 'rg.exe' : 'rg'

function systemRipgrepPath(): string | null {
  try {
    const cmd = process.platform === 'win32' ? 'where' : 'which'
    const out = execFileSync(cmd, [ripgrepExecutable], { encoding: 'utf-8' }).trim().split(/\r?\n/)[0]
    return out && fs.existsSync(out) ? out : null
  } catch {
    return null
  }
}

/**
 * Absolute path to a real ripgrep binary for file-tree tests.
 *
 * Production resolves ripgrep via `getBinaryPath('rg')` (mise shim → cherry.bin),
 * but neither location is populated in unit tests. Tests mock `getBinaryPath`
 * to return this binary so directory scans still spawn real ripgrep.
 */
export function testRipgrepPath(): string {
  const bundled = path.join(
    process.cwd(),
    'resources',
    'binaries',
    `${process.platform}-${process.arch}`,
    ripgrepExecutable
  )

  if (fs.existsSync(bundled)) return bundled

  if (process.env.CI) throw new Error(`Prepared test ripgrep binary not found: ${bundled}`)

  const systemPath = systemRipgrepPath()
  if (systemPath) return systemPath

  throw new Error('Test ripgrep binary not found')
}

/** Local runs may skip without ripgrep; CI requires the binary prepared by main's global setup. */
export function tryTestRipgrepPath(): string | null {
  try {
    return testRipgrepPath()
  } catch (error) {
    if (process.env.CI) throw error
    return null
  }
}
