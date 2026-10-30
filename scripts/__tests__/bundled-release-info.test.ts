import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'

import { generateBundledReleaseInfo } from '../release/bundled-release-info'

const roots: string[] = []
const notes = '<!--LANG:en-->New notes<!--LANG:zh-CN-->新的说明<!--LANG:END-->'
function fixture(version = '2.0.0') {
  const root = mkdtempSync(join(tmpdir(), 'bundled-release-'))
  roots.push(root)
  mkdirSync(join(root, 'resources/cherry-studio'), { recursive: true })
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }))
  writeFileSync(join(root, 'electron-builder.yml'), stringify({ releaseInfo: { releaseNotes: notes } }))
  writeFileSync(
    join(root, 'resources/cherry-studio/release-history.json'),
    JSON.stringify([{ version: '2.0.0', releaseNotes: notes.replace('New notes', 'Old notes') }])
  )
  return root
}
afterEach(() => roots.splice(0).forEach((root) => rmSync(root, { recursive: true, force: true })))

describe('bundled release resource', () => {
  it.each(['2.0.0', '2.1.0-rc.1'])(
    'ships fresh current notes for %s independently of renderer compilation',
    (version) => {
      const root = fixture(version)
      generateBundledReleaseInfo(root)
      const result = JSON.parse(readFileSync(join(root, 'resources/cherry-studio/release-info.json'), 'utf8'))
      expect(result.version).toBe(version)
      expect(result.releases[0]).toEqual({ version, releaseNotes: notes })
      expect(result.releases.filter((entry: { version: string }) => entry.version === version)).toHaveLength(1)
    }
  )

  it('fails when stable history or the current notes are incomplete', () => {
    expect(() => generateBundledReleaseInfo(fixture('3.0.0'))).toThrow('current stable version')
    const root = fixture()
    writeFileSync(join(root, 'electron-builder.yml'), 'releaseInfo: {}')
    expect(() => generateBundledReleaseInfo(root)).toThrow('requires a version and release notes')
  })
})
