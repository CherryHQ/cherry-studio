import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

type Step = { name: string; run?: string }
const workflow = parse(
  readFileSync(path.join(import.meta.dirname, '../../.github/workflows/sync-to-gitcode.yml'), 'utf8')
) as { jobs: Record<string, { steps: Step[] }> }

function script(name: string): string {
  const step = Object.values(workflow.jobs)
    .flatMap((job) => job.steps)
    .find((step) => step.name === name)
  if (!step?.run) throw new Error(`Missing workflow step: ${name}`)
  return step.run
}

describe('GitCode local signed artifacts', () => {
  let root: string
  let workspace: string
  let cache: string

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'gitcode-artifacts-'))
    workspace = path.join(root, 'workspace')
    cache = path.join(root, 'gitcode-signed', '12345')
    mkdirSync(workspace)
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  function run(name: string, env: Record<string, string> = {}, prefix = '') {
    return spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', prefix + script(name)], {
      cwd: workspace,
      env: { ...process.env, SIGNED_ARTIFACTS_DIR: cache, ...env },
      encoding: 'utf8'
    })
  }

  function stage(edition: string, blockmap = true) {
    const dist = path.join(workspace, 'dist')
    rmSync(dist, { recursive: true, force: true })
    mkdirSync(dist)
    const installer = `Cherry Studio-${edition}-setup.exe`
    const manifest = edition === 'cn' ? 'rc-cn.yml' : 'rc.yml'
    writeFileSync(path.join(dist, installer), `signed ${edition}`)
    writeFileSync(path.join(dist, manifest), `path: ${installer}\n`)
    if (blockmap) writeFileSync(path.join(dist, `${installer}.blockmap`), `signed blockmap ${edition}`)
    const result = run('Preserve signed Windows artifacts locally', { EDITION: edition, UPDATE_MANIFEST: manifest })
    expect(result.status, result.stderr).toBe(0)
    return installer
  }

  it('preserves both editions across checkout and assembles signed installers, manifests and blockmaps', () => {
    const globalInstaller = stage('global')
    const cnInstaller = stage('cn')
    rmSync(workspace, { recursive: true })
    mkdirSync(workspace)
    writeFileSync(path.join(workspace, 'electron-builder.cn.config.cjs'), '')
    const restored = run('Restore local signed Windows artifacts')
    expect(restored.status, restored.stderr).toBe(0)
    mkdirSync(path.join(workspace, 'release-assets'))
    const assembled = run('Replace Windows files with signed versions')
    expect(assembled.status, assembled.stderr).toBe(0)
    const assets = path.join(workspace, 'release-assets')
    expect(readdirSync(assets).sort()).toEqual(
      [
        globalInstaller,
        cnInstaller,
        `${globalInstaller}.blockmap`,
        `${cnInstaller}.blockmap`,
        'rc.yml',
        'rc-cn.yml'
      ].sort()
    )
    expect(readFileSync(path.join(assets, cnInstaller), 'utf8')).toBe('signed cn')
  })

  it('supports historical tags without the China edition or blockmaps', () => {
    stage('global', false)
    const restored = run('Restore local signed Windows artifacts')
    expect(restored.status, restored.stderr).toBe(0)
  })

  it.each(['missing-edition', 'missing-file', 'corrupt-file', 'missing-checksums'])(
    'rejects %s before release download',
    (failure) => {
      const installer = stage('global')
      if (failure === 'missing-edition') writeFileSync(path.join(workspace, 'electron-builder.cn.config.cjs'), '')
      if (failure === 'missing-file') rmSync(path.join(cache, 'global', installer))
      if (failure === 'corrupt-file') writeFileSync(path.join(cache, 'global', installer), 'unsigned or incomplete')
      if (failure === 'missing-checksums') rmSync(path.join(cache, 'global', 'SHA256SUMS-global.txt'))
      const restored = run('Restore local signed Windows artifacts')
      expect(restored.status).toBe(1)
      expect(restored.stdout).toContain('missing or invalid')
      expect(readdirSync(workspace)).not.toContain('signed-windows-artifacts')
    }
  )

  it('downloads only assets not replaced by the signed Windows build', () => {
    const installer = stage('global')
    expect(run('Restore local signed Windows artifacts').status).toBe(0)
    const otherAssets = [
      'Cherry Studio.dmg',
      'Cherry Studio.AppImage',
      'rc-mac.yml',
      'rc-linux.yml',
      'mac.zip.blockmap'
    ]
    const assetList = path.join(root, 'release-assets.txt')
    const downloadArgs = path.join(root, 'download-args.txt')
    writeFileSync(
      assetList,
      [installer, `${installer}.blockmap`, 'rc.yml', 'old-unsigned.exe', ...otherAssets].join('\n')
    )
    const result = run(
      'Download GitHub release assets',
      {
        TAG_NAME: 'v2.1.0-rc.1',
        ASSET_LIST: assetList,
        DOWNLOAD_ARGS: downloadArgs
      },
      `gh() {
      if [ "$2" = view ]; then
        cat "$ASSET_LIST"
      else
        printf '%s\\n' "$@" > "$DOWNLOAD_ARGS"
      fi
    }
    `
    )
    expect(result.status, result.stderr).toBe(0)
    expect(readFileSync(downloadArgs, 'utf8').trim().split('\n')).toEqual([
      'release',
      'download',
      'v2.1.0-rc.1',
      '--dir',
      'release-assets',
      ...otherAssets.flatMap((asset) => ['--pattern', asset])
    ])
  })
})
