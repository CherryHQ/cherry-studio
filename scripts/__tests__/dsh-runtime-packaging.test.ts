import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import {
  DSH_RUNTIME_ENTRY_NAMES,
  type DshRuntimeEntrySpecifier,
  resolveBundledDshRuntimeEntry
} from '@cherrystudio/dsh-bridge'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectRoot = path.join(import.meta.dirname, '..', '..')

describe('DSH runtime packaging', () => {
  it('builds every DSH subprocess entry into a bounded bundle directory', () => {
    for (const specifier of Object.keys(DSH_RUNTIME_ENTRY_NAMES) as DshRuntimeEntrySpecifier[]) {
      expect(existsSync(resolveBundledDshRuntimeEntry(specifier)), specifier).toBe(true)
    }

    const runtimeDirectory = path.dirname(resolveBundledDshRuntimeEntry('@deepseek-ai/dsh-sdk-jsonrpc-demo/bin'))
    const fileCount = readdirSync(runtimeDirectory, { recursive: true, withFileTypes: true }).filter((entry) =>
      entry.isFile()
    ).length
    expect(fileCount).toBeLessThan(200)
  })

  it('unpacks only the JS bundles and native runtime packages', () => {
    const config = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')) as {
      asarUnpack: string[]
    }
    const requiredPatterns = [
      'node_modules/@cherrystudio/dsh-bridge/dist/runtime/**',
      'node_modules/sharp/**',
      'node_modules/node-pty/**',
      'node_modules/koffi/**',
      'node_modules/@deepseek-ai/dsh-sandbox-windows-acl/**',
      'node_modules/@deepseek-ai/node-addon-landlock-run*/**'
    ]

    expect(config.asarUnpack).toEqual(expect.arrayContaining(requiredPatterns))
    expect(config.asarUnpack.filter((pattern) => pattern.includes('node_modules/@deepseek-ai/dsh-'))).toEqual([
      'node_modules/@deepseek-ai/dsh-sandbox-windows-acl/**'
    ])
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
})
