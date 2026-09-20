import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const require = createRequire(import.meta.url)
const { createOptionsForFile, signMacApp } = require('../mac-sign.js')

const projectRoot = path.resolve(import.meta.dirname, '../..')
const appPath = '/tmp/Cherry Studio.app'
const helperPath = path.join(appPath, 'Contents', 'Resources', 'system-speech', 'cherry-system-speech')
const helperEntitlements = path.join(projectRoot, 'build', 'entitlements.system-speech.plist')

describe('macOS signing policy', () => {
  it('uses dedicated empty entitlements only for the packaged system-speech helper', () => {
    const frameworkOptions = { entitlements: 'build/entitlements.mac.plist', hardenedRuntime: true }
    const originalOptionsForFile = (filePath: string) =>
      filePath.includes('/Frameworks/') ? frameworkOptions : { entitlements: 'build/entitlements.mac.plist' }
    const optionsForFile = createOptionsForFile(appPath, originalOptionsForFile)

    expect(optionsForFile(helperPath)).toEqual({
      entitlements: helperEntitlements
    })
    expect(optionsForFile(path.join(appPath, 'Contents', 'Frameworks', 'Electron Framework.framework'))).toBe(
      frameworkOptions
    )
    expect(optionsForFile(`${helperPath}-backup`)).toEqual({
      entitlements: 'build/entitlements.mac.plist'
    })
  })

  it('delegates the complete electron-builder signing configuration through osx-sign', async () => {
    const originalOptionsForFile: (filePath: string) => Record<string, unknown> = () => ({
      entitlements: 'build/entitlements.mac.plist',
      hardenedRuntime: true,
      timestamp: 'https://timestamp.apple.com'
    })
    const configuration = {
      app: appPath,
      identity: 'Developer ID Application: Cherry Studio',
      identityValidation: false,
      optionsForFile: originalOptionsForFile,
      platform: 'darwin',
      strictVerify: true
    }
    let receivedConfiguration: typeof configuration | undefined

    await signMacApp(configuration, async (options: typeof configuration) => {
      receivedConfiguration = options
    })

    expect(receivedConfiguration).toMatchObject({
      app: appPath,
      identity: configuration.identity,
      identityValidation: false,
      platform: 'darwin',
      strictVerify: true
    })
    expect(receivedConfiguration?.optionsForFile).not.toBe(originalOptionsForFile)
    expect(receivedConfiguration?.optionsForFile(helperPath)).toEqual({
      entitlements: helperEntitlements,
      hardenedRuntime: true,
      timestamp: 'https://timestamp.apple.com'
    })
  })

  it('wires the custom signer without weakening the inherited Electron policy', () => {
    const builder = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')) as {
      mac: { entitlementsInherit?: string; sign?: string; signIgnore?: string | string[] }
    }
    const manifest = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
      devDependencies: Record<string, string>
    }
    const entitlements = readFileSync(helperEntitlements, 'utf8')

    expect(builder.mac).toMatchObject({
      entitlementsInherit: 'build/entitlements.mac.plist',
      sign: 'scripts/mac-sign.js'
    })
    expect(builder.mac.signIgnore).toBeUndefined()
    expect(manifest.devDependencies['@electron/osx-sign']).toBe('1.3.3')
    expect(entitlements).toMatch(/<dict\s*\/>/)
    expect(entitlements).not.toContain('<key>')
  })
})
