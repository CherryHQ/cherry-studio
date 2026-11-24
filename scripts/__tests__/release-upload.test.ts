import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { parse, stringify } from 'yaml'

import { mergeMacManifests } from '../release/merge-mac-manifests'
import { selectReleaseUpload } from '../release/select-release-upload'

const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function artifacts(platform: string, architecture: string, edition = 'global') {
  const directory = mkdtempSync(path.join(tmpdir(), 'release-upload-'))
  roots.push(directory)
  const product = edition === 'cn' ? 'Cherry-Studio-CN' : 'Cherry-Studio'
  const channel = edition === 'cn' ? 'latest-cn' : 'latest'
  const base = `${product}-2.2.1-${platform}-${architecture}`
  const extensions = platform === 'mac' ? ['zip', 'zip.blockmap', 'dmg'] : ['AppImage', 'deb', 'rpm']
  for (const extension of extensions)
    writeFileSync(path.join(directory, `${base}.${extension}`), `${base}.${extension}`)
  const url = `${base}.${platform === 'mac' ? 'zip' : 'AppImage'}`
  const data = readFileSync(path.join(directory, url))
  const file = { url, sha512: createHash('sha512').update(data).digest('base64'), size: data.length }
  const manifest = `${channel}-${platform}${platform === 'linux' && architecture === 'arm64' ? '-arm64' : ''}.yml`
  const contents = stringify({
    version: '2.2.1',
    files: [file],
    path: url,
    sha512: file.sha512,
    releaseNotes: 'Reviewed bilingual release notes'
  })
  writeFileSync(path.join(directory, manifest), contents)
  return { directory, base, manifest, contents }
}

describe('release target uploads', () => {
  it.each(['global', 'cn'])('publishes disjoint macOS architecture manifests for %s', async (edition) => {
    const intel = artifacts('mac', 'x64', edition)
    const arm = artifacts('mac', 'arm64', edition)
    const x64 = await selectReleaseUpload({
      edition,
      platform: 'mac',
      tag: 'v2.2.1',
      architecture: 'x64',
      distDirectory: intel.directory
    })
    const arm64 = await selectReleaseUpload({
      edition,
      platform: 'mac',
      tag: 'v2.2.1',
      architecture: 'arm64',
      distDirectory: arm.directory
    })
    expect(Object.keys(x64)).toContain(`${edition}/mac/${intel.manifest.replace('.yml', '-x64.yml')}`)
    expect(Object.keys(arm64)).toContain(`${edition}/mac/${arm.manifest.replace('.yml', '-arm64.yml')}`)
    expect(Object.keys(x64).filter((name) => name in arm64)).toEqual([])
  })

  it('uploads stable release history from only the x64 Linux target', async () => {
    for (const architecture of ['x64', 'arm64']) {
      const target = artifacts('linux', architecture)
      const files = await selectReleaseUpload({
        edition: 'global',
        platform: 'linux',
        tag: 'v2.2.1',
        architecture,
        distDirectory: target.directory
      })
      expect('common/release-history.json' in files).toBe(architecture === 'x64')
      expect(Object.keys(files).filter((name) => !name.startsWith('common/'))).toHaveLength(4)
    }
  })

  it('rejects changed installers before recording an upload inventory', async () => {
    const target = artifacts('mac', 'x64')
    writeFileSync(path.join(target.directory, `${target.base}.zip`), 'corrupted')
    await expect(
      selectReleaseUpload({
        edition: 'global',
        platform: 'mac',
        tag: 'v2.2.1',
        architecture: 'x64',
        distDirectory: target.directory
      })
    ).rejects.toThrow('checksum mismatch')
  })

  it('rejects a target with a missing updater blockmap', async () => {
    const target = artifacts('mac', 'x64')
    rmSync(path.join(target.directory, `${target.base}.zip.blockmap`))
    await expect(
      selectReleaseUpload({
        edition: 'global',
        platform: 'mac',
        tag: 'v2.2.1',
        architecture: 'x64',
        distDirectory: target.directory
      })
    ).rejects.toThrow('Missing global release artifact')
  })
})

describe('macOS updater manifest aggregation', () => {
  it.each(['global', 'cn'])('retains both %s architectures, checksums, sizes, and release notes', (edition) => {
    const intel = artifacts('mac', 'x64', edition)
    const arm = artifacts('mac', 'arm64', edition)
    const merged = mergeMacManifests({ edition, version: '2.2.1', manifests: [intel.contents, arm.contents] })
    const update = parse(merged.contents)
    expect(update.files.map(({ url }) => url)).toEqual([`${intel.base}.zip`, `${arm.base}.zip`])
    for (const entry of update.files) {
      const directory = entry.url.includes('-x64.') ? intel.directory : arm.directory
      const bytes = readFileSync(path.join(directory, entry.url))
      expect(entry.sha512).toBe(createHash('sha512').update(bytes).digest('base64'))
      expect(entry.size).toBe(bytes.length)
    }
    expect(update.path).toBe(`${intel.base}.zip`)
    expect(update.sha512).toBe(update.files[0].sha512)
    expect(update.releaseNotes).toBe('Reviewed bilingual release notes')
    expect(merged.file).toBe(edition === 'cn' ? 'latest-cn-mac.yml' : 'latest-mac.yml')
  })

  it('rejects a missing architecture and duplicate or foreign-edition entries', () => {
    const intel = artifacts('mac', 'x64')
    const arm = artifacts('mac', 'arm64')
    expect(() => mergeMacManifests({ edition: 'global', version: '2.2.1', manifests: [intel.contents] })).toThrow(
      'Incomplete'
    )
    expect(() =>
      mergeMacManifests({ edition: 'global', version: '2.2.1', manifests: [intel.contents, intel.contents] })
    ).toThrow('Unexpected')
    expect(() =>
      mergeMacManifests({ edition: 'cn', version: '2.2.1', manifests: [intel.contents, arm.contents] })
    ).toThrow('Unexpected')
    expect(() =>
      mergeMacManifests({ edition: 'global', version: '2.2.2', manifests: [intel.contents, arm.contents] })
    ).toThrow('version mismatch')
  })
})
