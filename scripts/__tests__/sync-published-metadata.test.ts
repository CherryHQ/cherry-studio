import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { readBuilderReleaseNotes } from '../release/hotfix-release-notes'
import { syncPublishedMetadata } from '../release/sync-published-metadata'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

function fixture(version: string, mainVersion = '2.1.5') {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sync-release-test-'))
  roots.push(cwd)
  const write = (file: string, value: unknown) => {
    fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true })
    fs.writeFileSync(path.join(cwd, file), typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`)
  }
  const read = (file: string) => fs.readFileSync(path.join(cwd, file), 'utf8')
  const json = (file: string) => JSON.parse(read(file))
  write('gitconfig', '')
  const git = (...args: string[]) =>
    execFileSync('git', ['-c', 'commit.gpgsign=false', ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: path.join(cwd, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1' }
    }).trim()
  git('init', '-b', 'main')
  git('config', 'user.name', 'Release Test')
  git('config', 'user.email', 'release@example.com')
  const historyPath = 'resources/cherry-studio/release-history.json'
  const manifestPath = 'resources/builtin-agents/cherry-assistant/product-manifest.json'
  write('package.json', { version, dependencies: { old: '1' } })
  write('electron-builder.yml', 'appId: old\nreleaseInfo:\n  releaseNotes: |\n    Published notes.\n')
  write(historyPath, [{ version: '1.0.0', releaseNotes: 'Stale tag history.' }])
  write(manifestPath, { package: { version }, features: ['old'] })
  git('add', '.')
  git('commit', '-m', 'published release')
  git('tag', `v${version}`)
  write('package.json', { version: mainVersion, dependencies: { new: '2' } })
  write('electron-builder.yml', '# main configuration\nappId: new\nreleaseInfo:\n  releaseNotes: |\n    Main notes.\n')
  write(historyPath, [
    { version: '2.1.5', releaseNotes: 'Current notes.' },
    { version: '2.0.13', releaseNotes: 'Previous notes.' }
  ])
  write(manifestPath, { package: { version: mainVersion }, features: ['new'] })
  git('add', '.')
  git('commit', '-m', 'main development')
  const sync = () => syncPublishedMetadata({ cwd, tag: `v${version}` })
  return { cwd, read, json, git, sync, historyPath, manifestPath }
}

describe('version-owned published metadata', () => {
  it('imports only the published version history when an older line publishes later', () => {
    const f = fixture('2.0.14')
    const original = ['package.json', 'electron-builder.yml', f.manifestPath].map(f.read)
    expect(f.sync()).toBe(false)
    expect(['package.json', 'electron-builder.yml', f.manifestPath].map(f.read)).toEqual(original)
    expect(f.json(f.historyPath)).toEqual([
      { version: '2.1.5', releaseNotes: 'Current notes.' },
      { version: '2.0.14', releaseNotes: 'Published notes.' },
      { version: '2.0.13', releaseNotes: 'Previous notes.' }
    ])
    const history = f.read(f.historyPath)
    f.sync()
    expect(f.read(f.historyPath)).toBe(history)
  })

  it('advances only version and notes while retaining main dependencies, builder settings and manifest source', () => {
    const f = fixture('2.2.0')
    expect(f.sync()).toBe(true)
    expect(f.json('package.json')).toEqual({ version: '2.2.0', dependencies: { new: '2' } })
    expect(f.read('electron-builder.yml')).toContain('# main configuration\nappId: new')
    expect(readBuilderReleaseNotes(f.read('electron-builder.yml')).releaseNotes).toBe('Published notes.')
    expect(f.json(f.manifestPath).features).toEqual(['new'])
    expect(f.json(f.historyPath).map((entry: { version: string }) => entry.version)).toEqual([
      '2.2.0',
      '2.1.5',
      '2.0.13'
    ])
  })

  it('does not let a current-line patch overwrite a newer candidate on main', () => {
    const f = fixture('2.1.6', '2.2.0-rc.1')
    expect(f.sync()).toBe(false)
    expect(f.json('package.json').version).toBe('2.2.0-rc.1')
    expect(readBuilderReleaseNotes(f.read('electron-builder.yml')).releaseNotes).toBe('Main notes.')
  })

  it('advances candidate metadata without adding prereleases to stable history', () => {
    const f = fixture('2.2.0-rc.1')
    const history = f.read(f.historyPath)
    expect(f.sync()).toBe(true)
    expect(f.json('package.json').version).toBe('2.2.0-rc.1')
    expect(f.read(f.historyPath)).toBe(history)
  })

  it('rejects inconsistent tag metadata before changing main', () => {
    const f = fixture('2.0.14')
    f.git('tag', 'v2.0.15', 'v2.0.14')
    expect(() => syncPublishedMetadata({ cwd: f.cwd, tag: 'v2.0.15' })).toThrow('disagree')
    expect(f.git('status', '--porcelain')).toBe('')
  })
})
