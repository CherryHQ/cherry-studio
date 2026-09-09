import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { listBundledDshRuntimeEntries, resolveBundledDshRuntimeEntry } from '@cherrystudio/dsh-bridge'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const { DEFAULT_RUNTIME_ENTRY_SPECIFIERS, discoverDshRuntimePackaging, isForeignNativePath, isNativeFilePath } =
  await import('../../packages/dsh-bridge/scripts/runtimeEntries.cjs')

const { getDshPackageExclusions, getMainProcessDshPackages } = await import('../before-pack')

const projectRoot = path.join(import.meta.dirname, '..', '..')

describe('DSH runtime packaging', () => {
  it('builds every DSH subprocess entry into a bounded bundle directory', () => {
    for (const specifier of listBundledDshRuntimeEntries()) {
      expect(existsSync(resolveBundledDshRuntimeEntry(specifier)), specifier).toBe(true)
    }

    const runtimeDirectory = path.dirname(resolveBundledDshRuntimeEntry('@deepseek-ai/dsh-sdk-jsonrpc-demo/bin'))
    const fileCount = readdirSync(runtimeDirectory, { recursive: true, withFileTypes: true }).filter((entry) =>
      entry.isFile()
    ).length
    expect(fileCount).toBeLessThan(320)
  })

  it('discovers native sidecars and keeps foreign prebuilds identifiable', () => {
    const runtime = discoverDshRuntimePackaging({
      packageRoot: path.join(projectRoot, 'packages/dsh-bridge'),
      platform: 'darwin',
      arch: 'arm64'
    })
    expect(Object.keys(runtime.entries).sort()).toEqual([...DEFAULT_RUNTIME_ENTRY_SPECIFIERS].sort())
    expect(runtime.entries['@cherrystudio/dsh-bridge/plugin']).toBe('cherry-bridge.mjs')
    expect(runtime.entries['@deepseek-ai/dsh-sdk-jsonrpc-demo/bin']).toBeTruthy()
    expect(runtime.externalPackageNames).toEqual(
      expect.arrayContaining(['@deepseek-ai/dsh-sandbox-windows-acl', 'node-pty', 'koffi', 'sharp'])
    )
    expect(runtime.foreignNativePaths).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ packageName: 'node-pty', relative: 'prebuilds/darwin-x64/pty.node' })
      ])
    )
  })

  it('fails when a configured runtime root is no longer resolvable', () => {
    expect(() =>
      discoverDshRuntimePackaging({
        packageRoot: path.join(projectRoot, 'packages/dsh-bridge'),
        entrySpecifiers: ['@deepseek-ai/dsh-missing-entry']
      })
    ).toThrow('Missing configured DSH runtime entry @deepseek-ai/dsh-missing-entry')
  })

  it('unpacks runtime bundles and native DSH sidecars without unpacking the dependency closure', () => {
    const config = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')) as {
      asarUnpack: string[]
    }
    expect(config.asarUnpack).toEqual(
      expect.arrayContaining([
        'node_modules/@cherrystudio/dsh-bridge/dist/runtime/**',
        'node_modules/sharp/**',
        'node_modules/node-pty/**',
        'node_modules/koffi/**',
        'node_modules/@deepseek-ai/dsh-sandbox-windows-acl/**',
        'node_modules/@deepseek-ai/node-addon-landlock-run*/**'
      ])
    )
    expect(config.asarUnpack.filter((pattern) => pattern.includes('node_modules/@deepseek-ai/dsh-'))).toEqual([
      'node_modules/@deepseek-ai/dsh-sandbox-windows-acl/**'
    ])
  })

  it('keeps DSH packages externalized by the main-process bundle', () => {
    const mainProcessPackages = getMainProcessDshPackages(projectRoot)
    expect(mainProcessPackages.has('@deepseek-ai/dsh-sdk-client')).toBe(true)
    expect(mainProcessPackages.has('@deepseek-ai/dsh-sdk-protocol')).toBe(true)

    const exclusions = getDshPackageExclusions(
      {
        dshPackageNames: [
          '@deepseek-ai/dsh-sdk-client',
          '@deepseek-ai/dsh-sdk-protocol',
          '@deepseek-ai/dsh-session',
          '@deepseek-ai/dsh-tool-fs'
        ],
        externalPackageNames: [],
        packageRecords: [
          {
            name: '@deepseek-ai/dsh-sdk-client',
            manifest: { dependencies: { '@deepseek-ai/dsh-session': '0.1.0-rc.7' } }
          }
        ]
      },
      mainProcessPackages
    )
    expect(exclusions).not.toContain('!node_modules/@deepseek-ai/dsh-sdk-client/**')
    expect(exclusions).not.toContain('!node_modules/@deepseek-ai/dsh-sdk-protocol/**')
    expect(exclusions).not.toContain('!node_modules/@deepseek-ai/dsh-session/**')
    expect(exclusions).toContain('!node_modules/@deepseek-ai/dsh-tool-fs/**')
  })

  it('copies the runtime bundle into the unpacked resources directory', () => {
    const config = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')) as {
      extraResources: Array<{ from?: string; to?: string }>
    }
    expect(config.extraResources).toEqual(
      expect.arrayContaining([
        {
          from: 'packages/dsh-bridge/dist/runtime',
          to: 'app.asar.unpacked/node_modules/@cherrystudio/dsh-bridge/dist/runtime'
        }
      ])
    )
  })

  it('keeps filesystem-backed sandbox packages external', () => {
    const sandboxBundle = readFileSync(resolveBundledDshRuntimeEntry('@deepseek-ai/dsh-sandbox-local'), 'utf8')

    expect(sandboxBundle).toMatch(/from["']@deepseek-ai\/dsh-sandbox-windows-acl["']/)
    expect(sandboxBundle).toMatch(/from["']@deepseek-ai\/node-addon-landlock-run["']/)
  })

  it('installs Landlock platform executables as direct optional dependencies', () => {
    const manifest = JSON.parse(readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
      optionalDependencies: Record<string, string>
    }

    expect(manifest.optionalDependencies).toMatchObject({
      '@deepseek-ai/node-addon-landlock-run-linux-arm64': '0.1.1',
      '@deepseek-ai/node-addon-landlock-run-linux-x64': '0.1.1'
    })
  })

  it('classifies platform and architecture native paths without unpacking foreign files', () => {
    expect(isForeignNativePath('prebuilds/darwin-x64/pty.node', 'darwin', 'arm64', 'node-pty')).toBe(true)
    expect(isForeignNativePath('prebuilds/linuxmusl-x64/pty.node', 'linux', 'x64', 'node-pty')).toBe(true)
    expect(isNativeFilePath('prebuilds/darwin-arm64/spawn-helper')).toBe(true)
    expect(isForeignNativePath('prebuilds/darwin-arm64/spawn-helper', 'darwin', 'x64', 'node-pty')).toBe(true)
    expect(isForeignNativePath('prebuilds/win32-x64/pty.node', 'win32', 'x64', 'node-pty')).toBe(false)
  })
})
