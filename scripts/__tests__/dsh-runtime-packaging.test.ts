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

    const runtimeDirectory = path.dirname(resolveBundledDshRuntimeEntry('@cherrystudio/dsh-bridge/bin'))
    const fileCount = readdirSync(runtimeDirectory, { recursive: true, withFileTypes: true }).filter((entry) =>
      entry.isFile()
    ).length
    expect(fileCount).toBeLessThan(200)
  })

  it('does not collect the unused SDK umbrella into the production dependency graph', () => {
    const lock = parse(readFileSync(path.join(projectRoot, 'pnpm-lock.yaml'), 'utf8')) as {
      packages: Record<string, unknown>
      snapshots: Record<string, { dependencies?: Record<string, string> }>
    }
    const clients = Object.entries(lock.snapshots).filter(([key]) => key.startsWith('@deepseek-ai/dsh-sdk-client@'))
    expect(clients.length).toBeGreaterThan(0)
    for (const [, snapshot] of clients) expect(snapshot.dependencies).not.toHaveProperty('@deepseek-ai/dsh')
    expect(Object.keys(lock.packages).some((key) => key.startsWith('@deepseek-ai/dsh@'))).toBe(false)
    expect(Object.keys(lock.packages).some((key) => key.startsWith('@deepseek-ai/dsh-web-frontend@'))).toBe(false)
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
