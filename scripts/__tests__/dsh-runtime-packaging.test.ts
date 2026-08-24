import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { listBundledDshRuntimeEntries, resolveBundledDshRuntimeEntry } from '@cherrystudio/dsh-bridge'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const { discoverDshRuntimePackaging, isForeignNativePath, isNativeFilePath } = await import(
  '../../packages/dsh-bridge/scripts/runtimeEntries.cjs'
)

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

  it('does not encode the DSH dependency closure in static asar rules', () => {
    const config = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')) as {
      asarUnpack: string[]
    }
    expect(config.asarUnpack.filter((pattern) => pattern.includes('node_modules/@deepseek-ai/dsh-'))).toEqual([])
  })

  it('classifies platform and architecture native paths without unpacking foreign files', () => {
    expect(isForeignNativePath('prebuilds/darwin-x64/pty.node', 'darwin', 'arm64', 'node-pty')).toBe(true)
    expect(isForeignNativePath('prebuilds/linuxmusl-x64/pty.node', 'linux', 'x64', 'node-pty')).toBe(true)
    expect(isNativeFilePath('prebuilds/darwin-arm64/spawn-helper')).toBe(true)
    expect(isForeignNativePath('prebuilds/darwin-arm64/spawn-helper', 'darwin', 'x64', 'node-pty')).toBe(true)
    expect(isForeignNativePath('prebuilds/win32-x64/pty.node', 'win32', 'x64', 'node-pty')).toBe(false)
  })
})
