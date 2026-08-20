import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { isMainExternalModule } from '../../electron.vite.config'
import {
  bundleDshRuntimeTree,
  dshRuntimePackageExcludeFilters,
  dshRuntimePackageExcludeNames,
  shouldKeepRuntimePath
} from '../../packages/dsh-bridge/scripts/runtimeBuilder.cjs'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories) fs.rmSync(directory, { recursive: true, force: true })
  temporaryDirectories.length = 0
})

function makeDirectory(prefix: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function writeFile(root: string, relativePath: string, content: string): void {
  const filePath = path.join(root, relativePath)
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

function writeManifest(root: string, relativePath: string, manifest: Record<string, unknown>): void {
  writeFile(root, relativePath, `${JSON.stringify(manifest)}\n`)
}

function createRuntimeFixture(): { projectRoot: string; runtimeRoot: string; outputDir: string } {
  const projectRoot = makeDirectory('dsh-runtime-project-')
  const runtimeRoot = makeDirectory('dsh-runtime-tree-')
  const outputDir = makeDirectory('dsh-runtime-output-')
  writeFile(projectRoot, 'pnpm-lock.yaml', 'lockfileVersion: 9.0\n')
  writeManifest(runtimeRoot, 'package.json', { name: 'cherry-studio-dsh-runtime', private: true, type: 'module' })

  writeManifest(runtimeRoot, 'node_modules/@cherrystudio/dsh-bridge/package.json', {
    name: '@cherrystudio/dsh-bridge',
    version: '1.0.0',
    main: './dist/index.cjs',
    exports: {
      '.': { require: './dist/index.cjs', import: './dist/index.mjs' },
      './plugin': './dist/plugin.mjs'
    }
  })
  writeFile(runtimeRoot, 'node_modules/@cherrystudio/dsh-bridge/dist/index.cjs', 'module.exports = {}\n')
  writeFile(runtimeRoot, 'node_modules/@cherrystudio/dsh-bridge/dist/index.mjs', 'export {}\n')
  writeFile(runtimeRoot, 'node_modules/@cherrystudio/dsh-bridge/dist/plugin.mjs', 'export {}\n')

  writeManifest(runtimeRoot, 'node_modules/fixture-package/package.json', {
    name: 'fixture-package',
    version: '2.0.0',
    main: './lib/index.js',
    exports: {
      '.': './lib/index.js',
      './data': './data/config.json',
      './typed': { types: './data/config.d.ts', default: './data/config.json' }
    },
    bin: { fixture: './bin/fixture.cjs' }
  })
  writeFile(runtimeRoot, 'node_modules/fixture-package/lib/index.js', 'module.exports = require("./resource.bin")\n')
  writeFile(runtimeRoot, 'node_modules/fixture-package/lib/resource.bin', 'runtime resource\n')
  writeFile(runtimeRoot, 'node_modules/fixture-package/data/config.json', '{"runtime":true}\n')
  writeFile(runtimeRoot, 'node_modules/fixture-package/bin/fixture.cjs', '#!/usr/bin/env node\n')
  writeFile(runtimeRoot, 'node_modules/fixture-package/doc/runtime.js', 'module.exports = {}\n')
  writeFile(runtimeRoot, 'node_modules/fixture-package/README.md', 'documentation\n')
  writeFile(runtimeRoot, 'node_modules/fixture-package/lib/index.js.map', '{}\n')
  writeFile(runtimeRoot, 'node_modules/fixture-package/tests/ignored.js', 'ignored\n')
  writeManifest(runtimeRoot, 'node_modules/fixture-package/node_modules/duplicate/package.json', {
    name: 'duplicate',
    version: '1.0.0',
    main: './index.js'
  })
  writeFile(runtimeRoot, 'node_modules/fixture-package/node_modules/duplicate/index.js', 'module.exports = 1\n')
  writeManifest(runtimeRoot, 'node_modules/duplicate/package.json', {
    name: 'duplicate',
    version: '2.0.0',
    main: './index.js'
  })
  writeFile(runtimeRoot, 'node_modules/duplicate/index.js', 'module.exports = 2\n')

  return { projectRoot, runtimeRoot, outputDir }
}

describe('DSH runtime packaging', () => {
  it('externalizes development-only SDK imports while the packaged runtime owns them', () => {
    expect(isMainExternalModule('@deepseek-ai/dsh-sdk-client')).toBe(true)
    expect(isMainExternalModule('@deepseek-ai/dsh-sdk-protocol/subpath')).toBe(true)
  })

  it('discovers package entrypoints, preserves resources and nested versions, and excludes build-only files', async () => {
    const fixture = createRuntimeFixture()
    const { artifact } = await bundleDshRuntimeTree({
      ...fixture,
      platform: 'darwin',
      arch: 'arm64'
    })
    const paths = artifact.files.map((file) => file.path)

    expect(artifact).toMatchObject({ kind: 'tree', compression: 'zstd', archive: 'dsh-runtime.tar.zst' })
    expect(paths).toContain('node_modules/fixture-package/lib/resource.bin')
    expect(paths).toContain('node_modules/fixture-package/data/config.json')
    expect(paths).toContain('node_modules/fixture-package/doc/runtime.js')
    expect(paths).toContain('node_modules/fixture-package/node_modules/duplicate/index.js')
    expect(paths).toContain('node_modules/duplicate/index.js')
    expect(artifact.entrypoints).toContain('node_modules/fixture-package/bin/fixture.cjs')
    expect(artifact.entrypoints).toContain('node_modules/fixture-package/data/config.json')
    expect(artifact.entrypoints.every((entrypoint) => paths.includes(entrypoint))).toBe(true)
    expect(fs.existsSync(path.join(fixture.outputDir, artifact.archive))).toBe(true)
  })

  it('does not retain foreign native paths', () => {
    expect(shouldKeepRuntimePath('node_modules/pkg/prebuilds/linux-x64/addon.node', 'darwin', 'arm64')).toBe(false)
    expect(shouldKeepRuntimePath('node_modules/pkg/prebuilds/darwin-arm64/addon.node', 'darwin', 'arm64')).toBe(true)
    expect(shouldKeepRuntimePath('node_modules/node-pty/prebuilds/darwin-arm64/pty.node', 'darwin', 'arm64')).toBe(true)
    expect(shouldKeepRuntimePath('node_modules/node-pty/prebuilds/darwin-x64/pty.node', 'darwin', 'arm64')).toBe(false)
    expect(shouldKeepRuntimePath('node_modules/node-pty/prebuilds/win32-x64/pty.node', 'win32', 'x64')).toBe(true)
    expect(shouldKeepRuntimePath('node_modules/node-pty/prebuilds/win32-arm64/pty.node', 'win32', 'x64')).toBe(false)
    expect(shouldKeepRuntimePath('node_modules/node-pty/src/unix/pty.cc', 'darwin', 'arm64')).toBe(false)
    expect(
      shouldKeepRuntimePath('node_modules/node-pty/third_party/conpty/1.0/win10-x64/conpty.dll', 'win32', 'x64')
    ).toBe(true)
    expect(
      shouldKeepRuntimePath('node_modules/node-pty/third_party/conpty/1.0/win10-arm64/conpty.dll', 'win32', 'x64')
    ).toBe(false)
    expect(
      shouldKeepRuntimePath(
        'node_modules/koffi/node_modules/@koromix/koffi-darwin-arm64/darwin_arm64/koffi.node',
        'darwin',
        'arm64'
      )
    ).toBe(true)
    expect(
      shouldKeepRuntimePath(
        'node_modules/koffi/node_modules/@koromix/koffi-darwin-x64/darwin_x64/koffi.node',
        'darwin',
        'arm64'
      )
    ).toBe(false)
    expect(shouldKeepRuntimePath('node_modules/koffi/src/koffi/src/static.cjs', 'darwin', 'arm64')).toBe(true)
    expect(shouldKeepRuntimePath('node_modules/koffi/src/koffi/src/ffi.cc', 'darwin', 'arm64')).toBe(false)
    expect(shouldKeepRuntimePath('node_modules/renamed-native/src/runtime.cjs', 'darwin', 'arm64')).toBe(true)
    expect(shouldKeepRuntimePath('node_modules/renamed-native/src/runtime.test.js', 'darwin', 'arm64')).toBe(false)
    expect(shouldKeepRuntimePath('node_modules/renamed-native/src/runtime.cc', 'darwin', 'arm64')).toBe(false)
    expect(
      shouldKeepRuntimePath('node_modules/renamed-native/prebuilds/darwin-arm64/addon.node', 'darwin', 'arm64')
    ).toBe(true)
    expect(shouldKeepRuntimePath('node_modules/renamed-native/prebuilds/linux-x64/addon.node', 'darwin', 'arm64')).toBe(
      false
    )
    expect(shouldKeepRuntimePath('node_modules/renamed-native/build/binding.gyp', 'darwin', 'arm64')).toBe(false)
    expect(shouldKeepRuntimePath('node_modules/renamed-native/build/addon.pdb', 'darwin', 'arm64')).toBe(false)
    expect(
      shouldKeepRuntimePath('node_modules/@cherrystudio/dsh-bridge/dist/runtime/old.tar.zst', 'darwin', 'arm64')
    ).toBe(false)
    expect(shouldKeepRuntimePath('node_modules/pkg/README.md', 'darwin', 'arm64')).toBe(false)
    expect(shouldKeepRuntimePath('node_modules/pkg/doc/index.md', 'darwin', 'arm64')).toBe(false)
    expect(shouldKeepRuntimePath('node_modules/pkg/doc/directives.js', 'darwin', 'arm64')).toBe(true)
    expect(shouldKeepRuntimePath('node_modules/pkg/docs/runtime.json', 'darwin', 'arm64')).toBe(true)
    expect(shouldKeepRuntimePath('node_modules/pkg/lib/index.js.map', 'darwin', 'arm64')).toBe(false)
    expect(shouldKeepRuntimePath('node_modules/pkg/pnpm-lock.yaml', 'darwin', 'arm64')).toBe(false)
    expect(shouldKeepRuntimePath('node_modules/pkg/esbuild.config.js', 'darwin', 'arm64')).toBe(false)
    expect(shouldKeepRuntimePath('node_modules/pkg/data/model.bin', 'darwin', 'arm64')).toBe(true)
  })

  it('derives asar exclusions from the package graph without dropping shared dependencies', () => {
    const projectRoot = makeDirectory('dsh-runtime-graph-')
    writeManifest(projectRoot, 'package.json', {
      name: 'app',
      dependencies: {
        '@cherrystudio/dsh-bridge': '1.0.0',
        'app-entry': '1.0.0',
        shared: '1.0.0'
      }
    })
    writeManifest(projectRoot, 'node_modules/@cherrystudio/dsh-bridge/package.json', {
      name: '@cherrystudio/dsh-bridge',
      version: '1.0.0',
      dependencies: { '@deepseek-ai/shared': '1.0.0', 'dsh-only': '1.0.0', shared: '1.0.0' }
    })
    writeManifest(projectRoot, 'node_modules/dsh-only/package.json', {
      name: 'dsh-only',
      version: '1.0.0',
      dependencies: { 'dsh-nested': '1.0.0', 'node-pty': '1.1.0', koffi: '3.1.4' }
    })
    writeManifest(projectRoot, 'node_modules/dsh-nested/package.json', { name: 'dsh-nested', version: '1.0.0' })
    writeManifest(projectRoot, 'node_modules/@deepseek-ai/shared/package.json', {
      name: '@deepseek-ai/shared',
      version: '1.0.0'
    })
    writeManifest(projectRoot, 'node_modules/app-entry/package.json', {
      name: 'app-entry',
      version: '1.0.0',
      dependencies: { '@deepseek-ai/shared': '1.0.0' }
    })
    writeManifest(projectRoot, 'node_modules/shared/package.json', { name: 'shared', version: '1.0.0' })
    writeManifest(projectRoot, 'node_modules/node-pty/package.json', { name: 'node-pty', version: '1.1.0' })
    writeManifest(projectRoot, 'node_modules/koffi/package.json', { name: 'koffi', version: '3.1.4' })

    const filters = dshRuntimePackageExcludeFilters(projectRoot)
    const names = dshRuntimePackageExcludeNames(projectRoot)
    expect(filters).toContain('!node_modules/dsh-only/**')
    expect(filters).toContain('!node_modules/**/node_modules/dsh-nested/**')
    expect(names).toEqual(expect.arrayContaining(['node-pty', 'koffi']))
    expect(filters).toContain('!node_modules/node-pty/**')
    expect(filters).toContain('!node_modules/**/node_modules/koffi/**')
    expect(filters).not.toContain('!node_modules/@deepseek-ai/shared/**')
    expect(filters).not.toContain('!node_modules/shared/**')

    writeManifest(projectRoot, 'node_modules/app-entry/package.json', {
      name: 'app-entry',
      version: '1.0.0'
    })
    expect(dshRuntimePackageExcludeNames(projectRoot)).toContain('@deepseek-ai/shared')
  })
})
