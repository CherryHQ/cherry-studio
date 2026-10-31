import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const require = createRequire(import.meta.url)
const { createOptionsForFile, signMacApp } = require('../packaging/mac-sign.js')

const projectRoot = path.resolve(import.meta.dirname, '../..')
const appPath = '/tmp/Cherry Studio.app'
const helperPath = path.join(appPath, 'Contents', 'Helpers', 'cherry-system-speech')
const helperEntitlements = path.join(projectRoot, 'build', 'entitlements.system-speech.plist')

describe('macOS signing policy', () => {
  it('allows microphone capture in hardened Electron processes', () => {
    const builder = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8'))
    const entitlements = readFileSync(path.join(projectRoot, builder.mac.entitlementsInherit), 'utf8')

    expect(entitlements).toMatch(/<key>com\.apple\.security\.device\.audio-input<\/key>\s*<true\s*\/>/)
    expect(builder.mac.extendInfo.NSMicrophoneUsageDescription).toEqual(expect.any(String))
    expect(builder.mac.extendInfo.NSMicrophoneUsageDescription.trim()).not.toBe('')
  })

  it('declares macOS privacy access required by local MCP servers', () => {
    const builder = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8'))
    const mainEntitlements = readFileSync(
      path.join(projectRoot, builder.mac.entitlements ?? 'build/entitlements.mac.plist'),
      'utf8'
    )
    const inheritedEntitlements = readFileSync(path.join(projectRoot, builder.mac.entitlementsInherit), 'utf8')

    for (const key of [
      'NSCalendarsUsageDescription',
      'NSCalendarsFullAccessUsageDescription',
      'NSCalendarsWriteOnlyAccessUsageDescription',
      'NSRemindersUsageDescription',
      'NSRemindersFullAccessUsageDescription',
      'NSAppleEventsUsageDescription'
    ]) {
      expect(builder.mac.extendInfo[key]).toEqual(expect.any(String))
      expect(builder.mac.extendInfo[key].trim()).not.toBe('')
    }

    for (const entitlements of [mainEntitlements, inheritedEntitlements]) {
      expect(entitlements).toMatch(/<key>com\.apple\.security\.personal-information\.calendars<\/key>\s*<true\s*\/>/)
      expect(entitlements).toMatch(/<key>com\.apple\.security\.automation\.apple-events<\/key>\s*<true\s*\/>/)
    }
  })

  it('packages the native helper as code in Contents/Helpers', () => {
    const builder = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8'))

    expect(builder.mac.extraFiles).toContainEqual({
      from: 'packages/system-speech/dist/native/darwin-${arch}/cherry-system-speech',
      to: 'Helpers/cherry-system-speech'
    })
    expect(JSON.stringify(builder.mac.extraResources ?? [])).not.toContain('cherry-system-speech')
  })

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
      sign: 'scripts/packaging/mac-sign.js'
    })
    expect(builder.mac.signIgnore).toBeUndefined()
    expect(manifest.devDependencies['@electron/osx-sign']).toBe('1.3.3')
    expect(entitlements).toMatch(/<dict\s*\/>/)
    expect(entitlements).not.toContain('<key>')
  })
})
