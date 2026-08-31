import { readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import createChinaEditionConfig from '../../electron-builder.cn.config.cjs'
import { CHINA_EDITION, getExpectedReleaseArtifacts, getReleaseChannel, GLOBAL_EDITION } from '../release/edition'

const projectRoot = path.join(import.meta.dirname, '..', '..')
const packageMetadata = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8'))

describe('edition packaging', () => {
  it('keeps the existing global product and update identity', () => {
    const config = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8'))

    expect({
      appId: config.appId,
      productName: config.productName,
      protocol: config.protocols[0].schemes[0],
      publish: config.publish,
      windowsArtifactName: config.win.artifactName
    }).toEqual({
      appId: 'com.kangfenmao.CherryStudio',
      productName: 'Cherry Studio',
      protocol: 'cherrystudio',
      publish: { provider: 'generic', url: 'https://releases.cherry-ai.com' },
      windowsArtifactName: '${productName}-${version}-${arch}-setup.${ext}'
    })
  })

  it('gives the China edition an independent install and update identity', async () => {
    const config = await createChinaEditionConfig({
      packageMetadata: { value: Promise.resolve({ version: '2.1.0' }) }
    })

    expect(config).toMatchObject({
      extends: './electron-builder.yml',
      appId: 'com.cherryai.cherrystudio.cn',
      productName: 'Cherry Studio 中国版',
      extraMetadata: {
        cherryEdition: CHINA_EDITION
      },
      protocols: [{ name: 'Cherry Studio 中国版', schemes: ['cherrystudio-cn'] }],
      win: { executableName: 'Cherry Studio CN' },
      nsis: {
        shortcutName: 'Cherry Studio 中国版',
        uninstallDisplayName: 'Cherry Studio 中国版'
      },
      linux: {
        executableName: 'CherryStudioCN',
        desktop: { entry: { Name: 'Cherry Studio 中国版', StartupWMClass: 'CherryStudioCN' } },
        mimeTypes: ['x-scheme-handler/cherrystudio-cn']
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
})
