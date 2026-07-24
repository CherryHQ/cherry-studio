import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BinaryManager } from '../BinaryManager'

const describeFakeMise = process.platform === 'win32' ? describe.skip : describe

describeFakeMise('BinaryManager fake-mise integration', () => {
  let tempDir: string
  let misePath: string

  beforeEach(() => {
    MockMainCacheServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-fake-mise-'))
    misePath = path.join(tempDir, 'mise')
    vi.mocked(application.getPath).mockImplementation((key: string, filename?: string) => {
      const base = key === 'feature.binary.data' ? tempDir : `/mock/${key}`
      return filename ? path.join(base, filename) : base
    })

    const script = `#!/usr/bin/env node
const fs = require('node:fs')
const path = require('node:path')
const root = ${JSON.stringify('${FAKE_MISE_ROOT}')}
const actualRoot = process.env.FAKE_MISE_ROOT || root
const statePath = path.join(actualRoot, 'fake-installed-tools.json')
const shimsDir = path.join(actualRoot, 'shims')
const readState = () => fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {}
const writeState = (state) => fs.writeFileSync(statePath, JSON.stringify(state))
const [command, ...args] = process.argv.slice(2)
const state = readState()
if (command === 'use') {
  const spec = args.at(-1)
  const at = spec.lastIndexOf('@')
  const tool = at > 0 ? spec.slice(0, at) : spec
  const version = at > 0 && spec.slice(at + 1) !== 'latest' ? spec.slice(at + 1) : '1.2.3'
  state[tool] = [{ version, active: true }]
  fs.mkdirSync(shimsDir, { recursive: true })
  const name = tool.replace(/^core:/, '').split(':').at(-1)
  const shim = path.join(shimsDir, name)
  fs.writeFileSync(shim, '#!/bin/sh\\nexit 0\\n')
  fs.chmodSync(shim, 0o755)
  writeState(state)
} else if (command === 'ls') {
  // Match real mise: no-arg 'ls --json' returns an object keyed by spec, while
  // 'ls --json <spec>' returns a bare array of that spec's installs ([] if none).
  const tool = args.at(-1) === '--json' ? undefined : args.at(-1)
  process.stdout.write(JSON.stringify(tool === undefined ? state : (state[tool] ?? [])))
} else if (command === 'which') {
  const tool = args[0]
  const key = Object.keys(state).find((candidate) => candidate.replace(/^core:/, '').split(':').at(-1) === tool)
  if (!key) process.exit(1)
  process.stdout.write(path.join(shimsDir, tool) + '\\n')
} else if (command === 'uninstall') {
  const tool = args.at(-1)
  const name = tool.replace(/^core:/, '').split(':').at(-1)
  delete state[tool]
  fs.rmSync(path.join(shimsDir, name), { force: true })
  writeState(state)
} else if (command !== 'reshim' && command !== 'unuse') {
  process.stderr.write('unsupported command: ' + command)
  process.exit(2)
}
`.replace(JSON.stringify('${FAKE_MISE_ROOT}'), JSON.stringify(tempDir))

    fs.writeFileSync(misePath, script, { mode: 0o755 })
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  const createService = () => {
    const service = new BinaryManager()
    ;(service as any).miseBin = misePath
    ;(service as any).isolatedEnv = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
    )
    return service
  }

  it('installs, snapshots, and removes through the production process runner', async () => {
    const service = createService()

    await expect(service.installByName({ name: 'opencode' })).resolves.toBeUndefined()
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('feature.binary.tools')).toEqual([])
    await expect(service.getToolSnapshots(['opencode'])).resolves.toEqual({
      opencode: {
        name: 'opencode',
        availability: {
          source: 'mise',
          path: path.join(tempDir, 'shims', 'opencode'),
          version: '1.2.3'
        },
        application: { status: 'applied', version: '1.2.3' }
      }
    })

    await expect(service.removeTool({ name: 'opencode' })).resolves.toEqual({ status: 'removed' })
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('feature.binary.tools')).toEqual([])
    expect(fs.existsSync(path.join(tempDir, 'shims', 'opencode'))).toBe(false)

    const shimsDir = path.join(tempDir, 'shims')
    fs.mkdirSync(shimsDir, { recursive: true })
    fs.writeFileSync(
      path.join(tempDir, 'fake-installed-tools.json'),
      JSON.stringify({
        'core:node': [{ version: '22.23.1', active: true }]
      })
    )
    fs.writeFileSync(path.join(shimsDir, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })

    // node is a custom runtime (not in the fixed catalog). Custom Add persists the
    // definition and adopts the already-applied runtime without rewriting the
    // persisted definition with the resolved version, so no requestedVersion is stored.
    await expect(service.addCustomTool({ name: 'node', tool: 'core:node' })).resolves.toBeUndefined()
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('feature.binary.tools')).toEqual([
      { name: 'node', tool: 'core:node' }
    ])
    await expect(service.getToolSnapshots(['node'])).resolves.toMatchObject({
      node: { application: { status: 'applied', version: '22.23.1' } }
    })

    // Custom Add commits the portable definition before probing the backend. A
    // malformed listing therefore becomes a retryable failed operation, not a
    // rolled-back Add.
    fs.writeFileSync(path.join(tempDir, 'fake-installed-tools.json'), 'not json')
    await expect(service.addCustomTool({ name: 'mytool', tool: 'mytool' })).resolves.toBeUndefined()
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('feature.binary.tools')).toEqual([
      { name: 'node', tool: 'core:node' },
      { name: 'mytool', tool: 'mytool' }
    ])
    expect(MockMainCacheServiceUtils.getCacheValue('feature.binary.install_states')).toMatchObject({
      mytool: { status: 'failed', action: 'install' }
    })

    fs.writeFileSync(
      path.join(tempDir, 'fake-installed-tools.json'),
      JSON.stringify({ 'core:node': [{ version: '22.23.1', active: true }] })
    )
    await expect(service.installByName({ name: 'mytool' })).resolves.toBeUndefined()
    await expect(service.removeTool({ name: 'mytool' })).resolves.toEqual({ status: 'removed' })
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('feature.binary.tools')).toEqual([
      { name: 'node', tool: 'core:node' }
    ])
    expect(fs.existsSync(path.join(tempDir, 'shims', 'mytool'))).toBe(false)
  })
})
