import { readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { getNativeModuleFilters } from '../packaging/before-pack'

const projectRoot = path.resolve(import.meta.dirname, '../..')
const require = createRequire(import.meta.url)
const builderRequire = createRequire(require.resolve('electron-builder'))
const { FileMatcher } = builderRequire('app-builder-lib/out/fileMatcher')
const config = parse(readFileSync(path.join(projectRoot, 'electron-builder.yml'), 'utf8')) as {
  files: string[]
  extraResources: Array<{ from: string; to: string; filter?: string[] }>
  mac: { target: Array<{ target: string }> }
  dmg: { format: string; writeUpdateInfo: boolean }
}
const fileStat = statSync(path.join(projectRoot, 'package.json'))

function includesFile(filename: string, patterns = config.files): boolean {
  return new FileMatcher(projectRoot, projectRoot, (value: string) => value, patterns).createFilter()(
    path.join(projectRoot, filename),
    fileStat
  )
}

describe('packaged dependency contents', () => {
  it('uses ULFO for manual installation while retaining ZIP for macOS updates', () => {
    expect(config.dmg.format).toBe('ULFO')
    expect(config.mac.target.map(({ target }) => target)).toEqual(expect.arrayContaining(['dmg', 'zip']))
    expect(config.dmg.writeUpdateInfo).toBe(false)
  })

  it.each(['node_modules', 'node_modules/consumer/node_modules'])(
    'keeps Node dependency entry points under %s without alternate browser builds',
    (modules) => {
      for (const file of [
        '@huggingface/transformers/package.json',
        '@huggingface/transformers/dist/transformers.node.cjs',
        '@huggingface/transformers/dist/transformers.node.mjs',
        'mediabunny/dist/bundles/mediabunny.node.cjs',
        'mediabunny/dist/modules/src/index.js',
        '@google/genai/dist/node/index.cjs',
        '@google/genai/dist/node/index.mjs',
        '@google/genai/dist/tokenizer/node.cjs',
        '@google/genai/dist/vertex_internal/index.js',
        '@opentelemetry/semantic-conventions/build/src/index.js',
        '@opentelemetry/semantic-conventions/build/src/index-incubating.js'
      ]) {
        expect(includesFile(`${modules}/${file}`), file).toBe(true)
      }
      for (const file of [
        '@huggingface/transformers/src/transformers.js',
        '@huggingface/transformers/dist/transformers.js',
        '@huggingface/transformers/dist/transformers.min.js',
        '@huggingface/transformers/dist/transformers.web.js',
        '@huggingface/transformers/dist/transformers.web.min.js',
        '@huggingface/transformers/dist/transformers.node.min.cjs',
        '@huggingface/transformers/dist/transformers.node.min.mjs',
        '@huggingface/transformers/dist/ort-wasm-simd-threaded.jsep.mjs',
        'mediabunny/dist/bundles/mediabunny.cjs',
        'mediabunny/dist/bundles/mediabunny.mjs',
        'mediabunny/dist/bundles/mediabunny.min.cjs',
        'mediabunny/dist/bundles/mediabunny.min.mjs',
        '@google/genai/dist/web/index.mjs',
        '@google/genai/dist/index.cjs',
        '@google/genai/dist/index.mjs',
        '@opentelemetry/semantic-conventions/build/esm/index.js',
        '@opentelemetry/semantic-conventions/build/esnext/index.js'
      ]) {
        expect(includesFile(`${modules}/${file}`), file).toBe(false)
      }
    }
  )

  it('ships SQL and its journal once without schema-generation snapshots', () => {
    const journal = JSON.parse(
      readFileSync(path.join(projectRoot, 'migrations/sqlite-drizzle/meta/_journal.json'), 'utf8')
    ) as { entries: Array<{ tag: string }> }
    const sql = `${journal.entries[0].tag}.sql`
    expect(includesFile(`migrations/sqlite-drizzle/${sql}`)).toBe(false)
    const migration = config.extraResources.find((resource) => resource.to === 'migrations/sqlite-drizzle')!
    const root = path.join(projectRoot, migration.from)
    const includesMigration = new FileMatcher(root, root, (value: string) => value, migration.filter).createFilter()
    for (const file of [sql, 'meta/_journal.json']) {
      expect(includesMigration(path.join(root, file), fileStat), file).toBe(true)
    }
    expect(includesMigration(path.join(root, 'meta/0000_snapshot.json'), fileStat)).toBe(false)
  })

  it.each(['node_modules', 'node_modules/consumer/node_modules'])(
    'excludes the unused Lark ESM build under %s while preserving its Node entry',
    (modules) => {
      expect(includesFile(`${modules}/@larksuiteoapi/node-sdk/es/index.js`)).toBe(false)
      for (const file of ['package.json', 'lib/index.js']) {
        expect(includesFile(`${modules}/@larksuiteoapi/node-sdk/${file}`), file).toBe(true)
      }
    }
  )

  it.each(['node_modules', 'node_modules/consumer/node_modules'])(
    'excludes the PDF browser build under %s while preserving Node workers and rendering resources',
    (modules) => {
      for (const file of ['pdf-parse.es.js', 'pdf.worker.mjs']) {
        expect(includesFile(`${modules}/pdf-parse/dist/pdf-parse/web/${file}`), file).toBe(false)
      }
      for (const file of [
        'pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs',
        'pdf-parse/dist/pdf-parse/esm/pdf.worker.mjs',
        'pdfjs-dist/legacy/build/pdf.worker.min.mjs'
      ]) {
        expect(includesFile(`${modules}/${file}`), file).toBe(false)
      }
      for (const file of [
        'pdf-parse/package.json',
        'pdf-parse/dist/pdf-parse/cjs/index.cjs',
        'pdf-parse/dist/pdf-parse/esm/index.js',
        'pdf-parse/dist/worker/cjs/index.cjs',
        'pdf-parse/dist/worker/esm/index.js',
        'pdf-parse/dist/worker/pdf.worker.mjs',
        'pdfjs-dist/legacy/build/pdf.mjs',
        'pdfjs-dist/legacy/build/pdf.worker.mjs',
        'pdfjs-dist/cmaps/Adobe-GB1-UCS2.bcmap',
        'pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf',
        'pdfjs-dist/wasm/openjpeg.wasm'
      ]) {
        expect(includesFile(`${modules}/${file}`), file).toBe(true)
      }
    }
  )

  it('keeps the Computer Use SDK while its native helpers are installed outside ASAR', () => {
    expect(includesFile('node_modules/@cherrystudio/computer-use/dist/index.cjs')).toBe(true)
    for (const modules of ['node_modules', 'node_modules/consumer/node_modules']) {
      for (const platform of ['darwin', 'linux', 'win32']) {
        for (const arch of ['arm64', 'x64']) {
          expect(includesFile(`${modules}/@cherrystudio/computer-use-${platform}-${arch}/runtime/helper`)).toBe(false)
        }
      }
    }
  })

  it('keeps the SDK but excludes every native Claude payload, including nested packages', () => {
    for (const modules of ['node_modules', 'node_modules/consumer/node_modules']) {
      expect(includesFile(`${modules}/@anthropic-ai/claude-agent-sdk/sdk.mjs`)).toBe(true)
      for (const target of [
        'darwin-arm64',
        'darwin-x64',
        'linux-arm64',
        'linux-x64',
        'linux-arm64-musl',
        'linux-x64-musl',
        'win32-arm64',
        'win32-x64'
      ]) {
        for (const file of ['claude', 'claude.exe', 'package.json']) {
          expect(includesFile(`${modules}/@anthropic-ai/claude-agent-sdk-${target}/${file}`)).toBe(false)
        }
      }
    }
  })
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
            `@esbuild/${target}/package.json`,
            `@esbuild/${target}/${targetPlatform === 'win32' ? 'esbuild.exe' : 'bin/esbuild'}`,
            `@koromix/koffi-${target}/koffi.node`,
            `node-pty/prebuilds/${target}/pty.node`,
            `selection-hook/prebuilds/${target}/selection.node`
          ]) {
            expect(includesFile(`${modules}/${file}`, patterns), file).toBe(keep)
          }
        }
      }
      for (const target of ['linux-arm', 'linux-ia32', 'win32-ia32', 'freebsd-x64']) {
        expect(includesFile(`${modules}/@esbuild/${target}/package.json`, patterns), target).toBe(false)
      }
      for (const file of ['package.json', 'lib/main.js', 'bin/esbuild']) {
        expect(includesFile(`${modules}/esbuild/${file}`, patterns), file).toBe(true)
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
      'node_modules/pdfjs-dist/cmaps/Adobe-GB1-UCS2.bcmap',
      'resources/builtin-agents/icon.png'
    ]) {
      expect(includesFile(file), file).toBe(true)
    }
  })
})
