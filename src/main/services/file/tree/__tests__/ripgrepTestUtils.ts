import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

const ripgrepExecutable = process.platform === 'win32' ? 'rg.exe' : 'rg'

function platformDir(): string {
  const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
  const platform = process.platform === 'darwin' ? 'darwin' : process.platform === 'win32' ? 'win32' : 'linux'
  return `${arch}-${platform}`
}

function packageRootFromResolve(packageName: string): string | null {
  try {
    const entry = require.resolve(packageName)
    let dir = path.dirname(entry)
    while (true) {
      if (fs.existsSync(path.join(dir, 'package.json'))) return dir
      const parent = path.dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
  } catch {
    return null
  }
}

function pnpmPackageRoot(packagePrefix: string, packagePath: string): string | null {
  const pnpmDir = path.join(process.cwd(), 'node_modules', '.pnpm')
  try {
    for (const entry of fs.readdirSync(pnpmDir)) {
      if (!entry.startsWith(packagePrefix)) continue
      const root = path.join(pnpmDir, entry, 'node_modules', ...packagePath.split('/'))
      if (fs.existsSync(root)) return root
    }
  } catch {
    return null
  }
  return null
}

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
  const roots = [
    packageRootFromResolve('@anthropic-ai/claude-agent-sdk'),
    pnpmPackageRoot('@anthropic-ai+claude-agent-sdk@', '@anthropic-ai/claude-agent-sdk')
  ].filter((root): root is string => Boolean(root))

  for (const root of roots) {
    const candidate = path.join(root, 'vendor', 'ripgrep', platformDir(), ripgrepExecutable)
    if (fs.existsSync(candidate)) return candidate
  }

  const systemPath = systemRipgrepPath()
  if (systemPath) return systemPath

  throw new Error('Test ripgrep binary not found')
}

/** Non-throwing variant — returns `null` when no ripgrep binary can be located. */
export function tryTestRipgrepPath(): string | null {
  try {
    return testRipgrepPath()
  } catch {
    return null
  }
}
