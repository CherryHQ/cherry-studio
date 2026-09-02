import { readFileSync } from 'node:fs'
import path from 'node:path'

import { afterEach, describe, expect, it, vi } from 'vitest'
import { parse } from 'yaml'

import createChinaEditionConfig from '../../electron-builder.cn.config.cjs'
import { CHINA_EDITION, getExpectedReleaseArtifacts, getReleaseChannel, GLOBAL_EDITION } from '../release/edition'

const projectRoot = path.join(import.meta.dirname, '..', '..')
const packageMetadata = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))

type WorkflowStep = {
  if?: string
  name?: string
  run?: string
  with?: Record<string, unknown>
}

type GitCodeWorkflow = {
  jobs: {
    'build-windows-signed': {
      strategy?: { matrix?: { edition?: string[] } }
      steps: WorkflowStep[]
    }
    'sync-to-gitcode': { steps: WorkflowStep[] }
  }
}

describe('edition packaging', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  it('injects the selected edition into the renderer build', async () => {
    vi.stubEnv('CHERRY_EDITION', CHINA_EDITION)
    vi.resetModules()
    const { default: electronViteConfig, resolveRendererEdition } = await import('../../electron.vite.config')
    const rendererDefine = (
      electronViteConfig as {
        renderer: { define: Record<string, string> }
      }
    ).renderer.define

    expect(resolveRendererEdition(undefined)).toBe(GLOBAL_EDITION)
    expect(resolveRendererEdition(' CN ')).toBe(CHINA_EDITION)
    expect(() => resolveRendererEdition('enterprise')).toThrow('Unsupported renderer edition: enterprise')
    expect(rendererDefine.__APP_EDITION__).toBe(JSON.stringify(CHINA_EDITION))
  })

  it('pins the renderer edition for build and preview entry points', () => {
    expect(packageMetadata.scripts.build).toContain('CHERRY_EDITION=global')
    expect(packageMetadata.scripts['build:cn']).toContain('CHERRY_EDITION=cn')
    expect(packageMetadata.scripts['start:cn']).toContain('CHERRY_EDITION=cn')
    expect(packageMetadata.scripts['start:cn']).toContain('pnpm start')
  })

  it('uses the China build entry point for every China package', () => {
    for (const scriptName of ['build:unpack:cn', 'build:win:cn', 'build:mac:cn', 'build:linux:cn']) {
      expect(packageMetadata.scripts[scriptName]).toContain('pnpm run build:cn')
    }
  })

  it.each([
    ['win', 'x64'],
    ['win', 'arm64'],
    ['mac', 'x64'],
    ['mac', 'arm64'],
    ['linux', 'x64'],
    ['linux', 'arm64']
  ])('provides a China edition %s %s package entry point', (platform, arch) => {
    const script = packageMetadata.scripts[`build:${platform}:${arch}:cn`]

    expect(script).toContain('pnpm run build:cn')
    expect(script).toContain('--config electron-builder.cn.config.cjs')
    expect(script).toContain(`--${platform}`)
    expect(script).toContain(`--${arch}`)
  })

  it('keeps the existing global product and update identity', () => {
    const config = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8'))

    expect({
      appId: config.appId,
      edition: config.extraMetadata?.cherryEdition,
      nsisGuid: config.nsis.guid,
      productName: config.productName,
      protocol: config.protocols[0].schemes[0],
      publish: config.publish,
      windowsArtifactName: config.win.artifactName
    }).toEqual({
      appId: 'com.kangfenmao.CherryStudio',
      edition: GLOBAL_EDITION,
      nsisGuid: '41a4ccd8-bcc0-5710-9eee-0e164da68057',
      productName: 'Cherry Studio',
      protocol: 'cherrystudio',
      publish: { provider: 'generic', url: 'https://releases.cherry-ai.com' },
      windowsArtifactName: '${productName}-${version}-${arch}-setup.${ext}'
    })
  })

  it('changes only the package identity, edition marker, and update channel for the China edition', async () => {
    const config = await createChinaEditionConfig({
      packageMetadata: { value: Promise.resolve({ version: '2.1.0' }) }
    })

    expect(config).toEqual({
      extends: './electron-builder.yml',
      appId: 'com.cherryai.cherrystudio.cn',
      extraMetadata: {
        cherryEdition: CHINA_EDITION
      },
      publish: { provider: 'generic', url: 'https://releases.cherry-ai.com', channel: 'latest-cn' }
    })
  })

  it('shares the global Electron application name used for userData', async () => {
    const config = await createChinaEditionConfig({
      packageMetadata: { value: Promise.resolve(packageMetadata) }
    })
    const chinaPackageMetadata = { ...packageMetadata, ...config.extraMetadata }

    expect(packageMetadata.productName ?? packageMetadata.name).toBe('CherryStudio')
    expect(chinaPackageMetadata.productName ?? chinaPackageMetadata.name).toBe('CherryStudio')
  })

  it.each([
    ['2.1.0', 'latest', 'latest-cn'],
    ['2.1.0-rc.1', 'rc', 'rc-cn'],
    ['2.1.0-beta.2', 'beta', 'beta-cn']
  ])('maps %s to separate global and China update channels', (version, globalChannel, chinaChannel) => {
    expect(getReleaseChannel(version, GLOBAL_EDITION)).toBe(globalChannel)
    expect(getReleaseChannel(version, CHINA_EDITION)).toBe(chinaChannel)
  })

  it('defines the complete China edition artifact contract', () => {
    expect(
      getExpectedReleaseArtifacts({
        edition: CHINA_EDITION,
        platform: 'linux',
        productName: 'Cherry Studio',
        version: '2.1.0-rc.1'
      })
    ).toEqual({
      files: [
        'Cherry-Studio-CN-2.1.0-rc.1-linux-x64.AppImage',
        'Cherry-Studio-CN-2.1.0-rc.1-linux-x64.deb',
        'Cherry-Studio-CN-2.1.0-rc.1-linux-x64.rpm',
        'Cherry-Studio-CN-2.1.0-rc.1-linux-arm64.AppImage',
        'Cherry-Studio-CN-2.1.0-rc.1-linux-arm64.deb',
        'Cherry-Studio-CN-2.1.0-rc.1-linux-arm64.rpm'
      ],
      manifests: [
        {
          file: 'rc-cn-linux.yml',
          urls: ['Cherry-Studio-CN-2.1.0-rc.1-linux-x64.AppImage']
        },
        {
          file: 'rc-cn-linux-arm64.yml',
          urls: ['Cherry-Studio-CN-2.1.0-rc.1-linux-arm64.AppImage']
        }
      ]
    })
  })

  it('requires both macOS updater blockmaps', () => {
    expect(
      getExpectedReleaseArtifacts({
        edition: CHINA_EDITION,
        platform: 'mac',
        productName: 'Cherry Studio',
        version: '2.1.0'
      }).files
    ).toEqual([
      'Cherry-Studio-CN-2.1.0-mac-x64.zip',
      'Cherry-Studio-CN-2.1.0-mac-x64.zip.blockmap',
      'Cherry-Studio-CN-2.1.0-mac-arm64.zip',
      'Cherry-Studio-CN-2.1.0-mac-arm64.zip.blockmap',
      'Cherry-Studio-CN-2.1.0-mac-x64.dmg',
      'Cherry-Studio-CN-2.1.0-mac-arm64.dmg'
    ])
  })

  it('re-signs both Windows editions before syncing the release to GitCode', () => {
    const workflow = parse(
      readFileSync(path.join(projectRoot, '.github/workflows/sync-to-gitcode.yml'), 'utf8')
    ) as GitCodeWorkflow
    const buildJob = workflow.jobs['build-windows-signed']
    const syncJob = workflow.jobs['sync-to-gitcode']
    const buildStep = buildJob.steps.find((step) => step.name === 'Build Windows with code signing')
    const uploadStep = buildJob.steps.find((step) => step.name === 'Upload signed Windows artifacts')
    const downloadStep = syncJob.steps.find((step) => step.name === 'Download signed Windows artifacts')
    const replaceStep = syncJob.steps.find((step) => step.name === 'Replace Windows files with signed versions')

    expect(buildJob.strategy?.matrix?.edition).toEqual([GLOBAL_EDITION, CHINA_EDITION])
    expect(buildStep?.run).toMatch(/^\s*pnpm build:win:cn\s*$/m)
    expect(buildStep?.run).toMatch(/^\s*pnpm build:win\s*$/m)
    expect(buildStep?.run).toContain('electron-builder.cn.config.cjs')
    expect(uploadStep?.with?.name).toContain('matrix.edition')
    expect(uploadStep?.if).toContain('steps.build-windows.outputs.supported')
    expect(downloadStep?.with).toMatchObject({
      pattern: 'signed-windows-artifacts-*',
      'merge-multiple': true
    })
    expect(replaceStep?.run).toContain('cp signed-windows-artifacts/*.exe')
    expect(replaceStep?.run).toContain('cp signed-windows-artifacts/*.yml')
  })
})
