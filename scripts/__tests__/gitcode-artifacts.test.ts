import { createHash } from 'node:crypto'
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stringify } from 'yaml'

import { getExpectedReleaseArtifacts } from '../release/edition'
import { selectArchive, validateSourceRun } from '../release/release-artifact-source'
import { assembleArchive, stageAssets } from '../release/release-artifacts'

const repository = 'CherryHQ/cherry-studio'
const sha = 'a'.repeat(40)
const runners = { windows: 'windows-latest', mac: 'macos-latest', linux: 'ubuntu-latest' }

// These fixtures catch edition leaks, mixed builds and manifests pointing at the wrong bytes.
describe('dual-edition release archive', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'release-archive-'))
  })
  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function fixture(tag = 'v2.1.2', suffix = '') {
    const selected = path.join(root, `selected${suffix}`)
    for (const edition of ['global', 'cn']) {
      for (const [platform, runner] of Object.entries(runners)) {
        const dir = path.join(selected, `release-${tag}-${runner}-${edition}`)
        mkdirSync(dir, { recursive: true })
        const contract = getExpectedReleaseArtifacts({
          edition,
          platform,
          productName: 'Cherry Studio',
          version: tag.slice(1)
        })
        for (const file of contract.files) {
          writeFileSync(path.join(dir, file), `${suffix} signed ${file}`)
          if (file.endsWith('-setup.exe')) writeFileSync(path.join(dir, `${file}.blockmap`), `blockmap for ${file}`)
        }
        for (const manifest of contract.manifests) {
          const urls =
            platform === 'linux'
              ? contract.files.filter((file: string) =>
                  file.includes(manifest.file.includes('-arm64') ? '-arm64.' : '-x64.')
                )
              : manifest.urls
          const files = urls.map((url: string) => ({
            url,
            sha512: createHash('sha512')
              .update(readFileSync(path.join(dir, url)))
              .digest('base64')
          }))
          writeFileSync(
            path.join(dir, manifest.file),
            stringify({ files, path: files[0].url, sha512: files[0].sha512 })
          )
        }
      }
    }
    if (!tag.includes('-')) {
      mkdirSync(path.join(selected, `release-${tag}-history`))
      writeFileSync(path.join(selected, `release-${tag}-history/release-history.json`), '[]')
    }
    const builderFile = path.join(root, 'builder.yml')
    writeFileSync(builderFile, stringify({ releaseInfo: { releaseNotes: 'English\n中文' } }))
    return { selected, builderFile, tag }
  }

  async function assemble(tag = 'v2.1.2') {
    const options = {
      ...fixture(tag),
      directory: path.join(root, 'archive'),
      baseline: '',
      repository,
      sha,
      runId: '100',
      platform: 'all'
    }
    return { options, metadata: await assembleArchive(options) }
  }

  it.each(['v2.1.2', 'v2.2.0-rc.1'])('keeps GitHub Global-only and GitCode complete for %s', async (tag) => {
    const { options, metadata } = await assemble(tag)
    const github = path.join(root, 'github')
    const gitcode = path.join(root, 'gitcode')
    stageAssets(options.directory, github, metadata, ['global'])
    stageAssets(options.directory, gitcode, metadata, ['global', 'cn'])
    for (const arch of ['x64', 'arm64']) {
      const globalMap = `Cherry-Studio-${tag.slice(1)}-win-${arch}-setup.exe.blockmap`
      const cnMap = `Cherry-Studio-CN-${tag.slice(1)}-win-${arch}-setup.exe.blockmap`
      expect(readFileSync(path.join(github, globalMap), 'utf8')).toBe(`blockmap for ${globalMap.slice(0, -9)}`)
      expect(readFileSync(path.join(gitcode, cnMap), 'utf8')).toBe(`blockmap for ${cnMap.slice(0, -9)}`)
    }
    expect(readdirSync(github).some((file) => file.includes('-CN-') || file.includes('-cn'))).toBe(false)
    const channel = tag.includes('-') ? 'rc' : 'latest'
    expect(readdirSync(gitcode)).toEqual(
      expect.arrayContaining([
        `${channel}.yml`,
        `${channel}-cn.yml`,
        `${channel}-cn-mac.yml`,
        `${channel}-cn-linux-arm64.yml`
      ])
    )
    for (const file of readdirSync(github))
      expect(readFileSync(path.join(gitcode, file))).toEqual(readFileSync(path.join(github, file)))
    const legacy = path.join(root, 'legacy')
    const files = Object.fromEntries(metadata.files.map((file: string) => [file, 'old checksum']))
    stageAssets(options.directory, legacy, { ...metadata, files }, ['global', 'cn'])
    expect(readdirSync(legacy)).toEqual(readdirSync(gitcode))
  })

  it('replaces both editions of the selected platform and preserves other platforms from the same SHA', async () => {
    const { options } = await assemble()
    const selected = fixture(options.tag, '-retry')
    const directory = path.join(root, 'retry')
    const retried = await assembleArchive({
      ...options,
      ...selected,
      baseline: options.directory,
      directory,
      platform: 'windows',
      runId: '101'
    })
    for (const edition of ['global', 'cn']) {
      const windows = retried.files.find(
        (file: string) => file.startsWith(`${edition}/windows/`) && file.endsWith('.exe')
      )!
      const mac = retried.files.find((file: string) => file.startsWith(`${edition}/mac/`) && file.endsWith('.zip'))!
      expect(readFileSync(path.join(directory, windows), 'utf8')).toContain('-retry signed')
      expect(readFileSync(path.join(directory, mac))).toEqual(readFileSync(path.join(options.directory, mac)))
    }
    await expect(
      assembleArchive({
        ...options,
        ...selected,
        baseline: options.directory,
        directory: path.join(root, 'bad'),
        platform: 'windows',
        sha: 'b'.repeat(40)
      })
    ).rejects.toThrow('sha does not match')
    await expect(
      assembleArchive({
        ...options,
        baseline: path.join(root, 'missing'),
        directory: path.join(root, 'missing-retry'),
        platform: 'mac'
      })
    ).rejects.toThrow()
  })

  it.each([
    ['corrupt package', 'checksum mismatch'],
    ['cross-edition manifest', 'does not reference'],
    ['missing CN assets', 'ENOENT']
  ])('rejects a build with %s during assembly', async (problem, error) => {
    const input = fixture()
    const windows = path.join(input.selected, 'release-v2.1.2-windows-latest-global')
    if (problem === 'corrupt package') {
      writeFileSync(path.join(windows, 'Cherry-Studio-2.1.2-win-x64-setup.exe'), 'corrupt')
    } else if (problem === 'cross-edition manifest') {
      const manifest = path.join(windows, 'latest.yml')
      writeFileSync(manifest, readFileSync(manifest, 'utf8').replaceAll('Cherry-Studio-', 'Cherry-Studio-CN-'))
    } else {
      rmSync(path.join(input.selected, 'release-v2.1.2-macos-latest-cn'), { recursive: true })
    }
    await expect(
      assembleArchive({
        ...input,
        directory: path.join(root, 'archive'),
        baseline: '',
        repository,
        sha,
        runId: '100',
        platform: 'all'
      })
    ).rejects.toThrow(error)
  })
})

describe('archive provenance', () => {
  const run = {
    head_repository: { full_name: repository },
    head_branch: 'main',
    head_sha: 'b'.repeat(40),
    path: '.github/workflows/release.yml',
    event: 'workflow_dispatch',
    display_title: `Release build all release/v2.1.2 @ ${sha}`
  }
  const expected = { repository, tag: 'v2.1.2', sha, allPlatforms: true }
  it('rejects wrong repositories, workflows, tags, SHAs and partial builds', () => {
    expect(() => validateSourceRun(run, expected)).not.toThrow()
    for (const invalid of [
      { head_repository: { full_name: 'fork/repo' } },
      { head_branch: 'release/v2.1.2' },
      { display_title: `Release build all release/v2.1.2 @ ${'c'.repeat(40)}` },
      { path: '.github/workflows/ci.yml' },
      { event: 'push' },
      { display_title: 'Release build windows' }
    ]) {
      expect(() => validateSourceRun({ ...run, ...invalid }, expected)).toThrow('Artifact source')
    }
  })
  it('chooses the newest retained same-SHA archive without reusing this run', () => {
    const artifact = {
      id: 1,
      name: 'release-bundle-v2.1.2',
      expired: false,
      releaseSha: sha,
      workflow_run: { head_sha: 'b'.repeat(40), id: 100 }
    }
    const options = { tag: 'v2.1.2', sha, excludedRunId: '102' }
    expect(
      selectArchive(
        [
          artifact,
          { ...artifact, id: 2, expired: true },
          { ...artifact, id: 3, releaseSha: 'other', workflow_run: { head_sha: sha, id: 101 } },
          { ...artifact, id: 4, workflow_run: { head_sha: sha, id: 102 } }
        ],
        options
      )
    ).toEqual(artifact)
    expect(selectArchive([{ ...artifact, expired: true }], options)).toBeUndefined()
  })
})
