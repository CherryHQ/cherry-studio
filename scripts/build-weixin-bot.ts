/**
 * Postinstall script to build @pinixai/weixin-bot
 *
 * The package is published as TypeScript source without a dist/ directory.
 * This script runs `tsc` inside the package to produce the dist/ output
 * that the package.json "exports" field references.
 */

import { execSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

function main() {
  const require_ = createRequire(import.meta.url)

  let pkgDir: string
  try {
    const pkgJson = require_.resolve('@pinixai/weixin-bot/package.json')
    pkgDir = path.dirname(pkgJson)
  } catch {
    console.log('[build-weixin-bot] Package not installed, skipping.')
    process.exit(0)
  }

  const distIndex = path.join(pkgDir, 'dist', 'index.js')
  if (existsSync(distIndex)) {
    console.log('[build-weixin-bot] Already built, skipping.')
    process.exit(0)
  }

  try {
    execSync('npx tsc', { cwd: pkgDir, stdio: 'pipe' })
    console.log('[build-weixin-bot] Successfully built @pinixai/weixin-bot')
  } catch (error) {
    console.error('[build-weixin-bot] Failed to build:', error instanceof Error ? error.message : String(error))
    process.exit(1)
  }
}

main()
