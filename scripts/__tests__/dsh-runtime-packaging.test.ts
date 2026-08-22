import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { DSH_RUNTIME_ENTRY_NAMES, resolveBundledDshRuntimeEntry } from '@cherrystudio/dsh-bridge'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const projectRoot = path.join(import.meta.dirname, '..', '..')

describe('DSH runtime packaging', () => {
  it('builds every DSH subprocess entry into a bounded bundle directory', () => {
    for (const specifier of Object.keys(DSH_RUNTIME_ENTRY_NAMES)) {
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
      'node_modules/@deepseek-ai/node-addon-landlock-run*/**'
    ]

    expect(config.asarUnpack).toEqual(expect.arrayContaining(requiredPatterns))
    expect(config.asarUnpack.filter((pattern) => pattern.includes('node_modules/@deepseek-ai/dsh-'))).toEqual([])
  })
})
