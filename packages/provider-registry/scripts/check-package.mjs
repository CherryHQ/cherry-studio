import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'tsdown'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)
const directory = mkdtempSync(join(tmpdir(), 'provider-registry-package-'))
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))

function run(command, args, cwd = directory) {
  return execFileSync(command, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

try {
  const [packed] = JSON.parse(
    run(npm, ['pack', '--ignore-scripts', '--json', '--pack-destination', directory], packageRoot)
  )
  for (const file of ['LICENSE', 'data/models.json', 'data/providers.json', 'data/provider-models.json']) {
    assert(
      packed.files.some((entry) => entry.path === file),
      `Missing published file: ${file}`
    )
  }
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  run(npm, [
    'install',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    join(directory, packed.filename),
    `zod@${manifest.devDependencies.zod}`
  ])

  const assertions = `
    const registry = core.createRegistry(data.bundledCatalog)
    assert.equal(registry.findProvider('openai').name, 'OpenAI')
    assert.equal(registry.findModel('gpt-6.1-sol').id, 'gpt-6-1-sol')
    assert.equal(registry.findModel('nvidia/gpt-oss-20b').id, 'gpt-oss-20b')
    assert.equal(registry.findOverride('cherryin', 'qwen/qwen3.5-9b').modelId, 'qwen3-5-9b')
    for (const [name, read] of [
      ['models', node.readModelRegistry],
      ['providers', node.readProviderRegistry],
      ['provider-models', node.readProviderModelRegistry]
    ]) {
      const path = require.resolve('@cherrystudio/provider-registry/data/' + name + '.json')
      assert.equal(typeof read(path).version, 'string')
    }
  `
  writeFileSync(
    join(directory, 'consumer.mjs'),
    `
    import assert from 'node:assert/strict'
    import { createRequire } from 'node:module'
    import * as core from '@cherrystudio/provider-registry'
    import * as data from '@cherrystudio/provider-registry/data'
    import * as node from '@cherrystudio/provider-registry/node'
    const require = createRequire(import.meta.url)
    ${assertions}
  `
  )
  writeFileSync(
    join(directory, 'consumer.cjs'),
    `
    const assert = require('node:assert/strict')
    const core = require('@cherrystudio/provider-registry')
    const data = require('@cherrystudio/provider-registry/data')
    const node = require('@cherrystudio/provider-registry/node')
    ${assertions}
  `
  )
  run(process.execPath, ['consumer.mjs'])
  run(process.execPath, ['consumer.cjs'])

  const types = `
    import { createRegistry, parseModelSnapshot, type ModelConfig } from '@cherrystudio/provider-registry'
    import { bundledCatalog } from '@cherrystudio/provider-registry/data'
    import { bundledModels } from '@cherrystudio/provider-registry/data/models'
    import { bundledProviders } from '@cherrystudio/provider-registry/data/providers'
    import { bundledProviderModels } from '@cherrystudio/provider-registry/data/provider-models'
    import { readModelRegistry } from '@cherrystudio/provider-registry/node'
    const snapshot = parseModelSnapshot({ models: bundledModels, providerModels: bundledProviderModels })
    const registry = createRegistry({ ...snapshot, providers: bundledProviders })
    const model: ModelConfig | null = registry.findModel('gpt-4o')
    createRegistry(bundledCatalog).findProvider('openai')
    readModelRegistry('models.json').models satisfies ModelConfig[]
    // @ts-expect-error Query collections are read-only.
    registry.listModels().push(model)
  `
  writeFileSync(join(directory, 'consumer.mts'), types)
  writeFileSync(join(directory, 'consumer.cts'), types)
  run(process.execPath, [
    require.resolve('typescript/bin/tsc'),
    '--noEmit',
    '--strict',
    '--module',
    'nodenext',
    '--target',
    'es2022',
    'consumer.mts',
    'consumer.cts'
  ])

  // Export the whole core so Node-only dependencies cannot hide behind tree shaking.
  writeFileSync(
    join(directory, 'portable.ts'),
    `
    export * from '@cherrystudio/provider-registry'
    export { bundledCatalog } from '@cherrystudio/provider-registry/data'
  `
  )
  await build({
    cwd: directory,
    config: false,
    entry: ['portable.ts'],
    outDir: 'browser',
    platform: 'browser',
    format: 'esm',
    dts: false,
    deps: { alwaysBundle: [/./] },
    logLevel: 'silent'
  })
  run(process.execPath, [
    '--conditions=react-native',
    '--input-type=module',
    '-e',
    `
    import { createRegistry } from '@cherrystudio/provider-registry'
    import { bundledCatalog } from '@cherrystudio/provider-registry/data'
    if (!createRegistry(bundledCatalog).findModel('gpt-6.1-sol')) throw new Error('Missing bundled model')
  `
  ])
  process.stdout.write(
    'Package checks passed: tarball, ESM/CJS, TypeScript, browser bundle and React Native conditions.\n'
  )
} catch (error) {
  if (error.stdout) process.stderr.write(error.stdout)
  if (error.stderr) process.stderr.write(error.stderr)
  throw error
} finally {
  rmSync(directory, { recursive: true, force: true })
}
