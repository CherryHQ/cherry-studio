import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { parse } from 'yaml'

import {
  mergeReleaseNotes,
  parseReleaseHistory,
  validateCurrentReleaseHistory
} from '../../src/shared/utils/releaseNotes'

export function generateBundledReleaseInfo(root: string) {
  const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'))
  const builder = parse(readFileSync(resolve(root, 'electron-builder.yml'), 'utf8'))
  const releaseNotes = builder.releaseInfo?.releaseNotes
  if (typeof version !== 'string' || typeof releaseNotes !== 'string' || !releaseNotes.trim()) {
    throw new Error('Bundled release information requires a version and release notes')
  }
  const history = parseReleaseHistory(
    readFileSync(resolve(root, 'resources/cherry-studio/release-history.json'), 'utf8')
  )
  const current = { version, releaseNotes }
  validateCurrentReleaseHistory(current, history)
  const info = { version, releases: mergeReleaseNotes(current, history) }
  const destination = resolve(root, 'resources/cherry-studio/release-info.json')
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, `${JSON.stringify(info, null, 2)}\n`)
  return info
}

if (process.argv[1]?.endsWith('bundled-release-info.ts')) generateBundledReleaseInfo(process.cwd())
