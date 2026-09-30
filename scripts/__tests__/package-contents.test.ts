import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { getNativeModuleFilters } from '../before-pack'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const { FileMatcher } = builderRequire('app-builder-lib/out/fileMatcher')
const config = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')) as { files: string[] }
const fileStat = statSync(path.join(projectRoot, 'package.json'))

function includesFile(filename: string, patterns = config.files): boolean {
  return new FileMatcher(projectRoot, projectRoot, (value: string) => value, patterns).createFilter()(
    path.join(projectRoot, filename),
    fileStat
  )
}

describe('packaged dependency contents', () => {
  it.each([
    ['darwin', 'arm64', 'darwin-arm64'],
    ['darwin', 'x64', 'darwin-x64'],
    ['linux', 'arm64', 'linux-arm64-gnu'],
    ['linux', 'x64', 'linux-x64-gnu'],
    ['win32', 'arm64', 'win32-arm64-msvc'],
    ['win32', 'x64', 'win32-x64-msvc']
  ])('keeps only %s %s native payloads, including nested dependencies', (platform, arch, nativeBindingTarget) => {
    const patterns = [...config.files, ...getNativeModuleFilters(platform, arch)]
    for (const modules of ['node_modules', 'node_modules/consumer/node_modules']) {
      for (const targetPlatform of ['darwin', 'linux', 'win32']) {
        for (const targetArch of ['arm64', 'x64']) {
          const target = `${targetPlatform}-${targetArch}`
          const keep = targetPlatform === platform && targetArch === arch
          for (const file of [
            `@koromix/koffi-${target}/koffi.node`,
            `node-pty/prebuilds/${target}/pty.node`,
            `selection-hook/prebuilds/${target}/selection.node`,
            `@anthropic-ai/claude-agent-sdk-${target}/claude`
          ]) {
            expect(includesFile(`${modules}/${file}`, patterns), file).toBe(keep)
          }
        }
      }
      for (const target of [
        'darwin-arm64',
        'darwin-x64',
        'darwin-universal',
        'linux-arm64-gnu',
        'linux-x64-gnu',
        'linux-x64-musl',
        'win32-arm64-msvc',
        'win32-x64-msvc'
      ]) {
        const file = `${modules}/@mariozechner/clipboard-${target}/clipboard.node`
        expect(includesFile(file, patterns), file).toBe(target === nativeBindingTarget)
      }
      for (const target of [
        'darwin-arm64',
        'darwin-x64',
        'linux-arm64-gnu',
        'linux-x64-gnu',
        'win32-arm64-msvc',
        'win32-ia32-msvc',
        'win32-x64-msvc'
      ]) {
        const file = `${modules}/node-addon-require-builtin-${target}/package.json`
        expect(includesFile(file, patterns), file).toBe(target === nativeBindingTarget)
      }
    }
  })

  it.each(['node_modules', 'node_modules/consumer/node_modules'])(
    'excludes SQLite build inputs and cached binaries under %s while preserving its runtime',
    (modules) => {
      const root = `${modules}/better-sqlite3`
      for (const file of [
        'deps/sqlite3/sqlite3.c',
        'build/Release/obj/gen/sqlite3/sqlite3.c',
        'bin/darwin-x64-149/better-sqlite3.node',
        'src/better_sqlite3.cpp'
      ]) {
        expect(includesFile(`${root}/${file}`), file).toBe(false)
      }
      for (const file of ['package.json', 'lib/database.js', 'build/Release/better_sqlite3.node']) {
        expect(includesFile(`${root}/${file}`), file).toBe(true)
      }
    }
  )

  it('excludes dependency documentation images without removing runtime assets or source JS', () => {
    for (const file of [
      'node_modules/selection-hook/docs/images/selection-hook.gif',
      'node_modules/@earendil-works/pi-coding-agent/docs/images/exy.png'
    ]) {
      expect(includesFile(file), file).toBe(false)
    }
    for (const file of [
      'node_modules/koffi/src/koffi/index.cjs',
      'node_modules/@deepseek-ai/dsh-sandbox-windows-acl/assets/cherry_acl.ps1',
      'node_modules/@deepseek-ai/dsh-sandbox-windows-acl/assets/SKILL.md',
      'node_modules/pdfjs-dist/cmaps/Adobe-GB1-UCS2.bcmap',
      'resources/builtin-agents/icon.png'
    ]) {
      expect(includesFile(file), file).toBe(true)
    }
  })
})
