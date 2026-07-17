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

    await expect(service.installTool({ intent: { name: 'fd', tool: 'fd' } })).resolves.toEqual({ version: '1.2.3' })
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('feature.binary.tools')).toEqual([
      { name: 'fd', tool: 'fd' }
    ])
    await expect(service.getToolSnapshots(['fd'])).resolves.toEqual({
      fd: {
        name: 'fd',
        intent: { name: 'fd', tool: 'fd' },
        availability: { source: 'mise', tool: 'fd', path: path.join(tempDir, 'shims', 'fd'), version: '1.2.3' },
        application: { status: 'applied', version: '1.2.3' }
      }
    })

    await expect(service.removeTool('fd')).resolves.toBeUndefined()
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('feature.binary.tools')).toEqual([])
    expect(fs.existsSync(path.join(tempDir, 'shims', 'fd'))).toBe(false)

    const shimsDir = path.join(tempDir, 'shims')
    fs.mkdirSync(shimsDir, { recursive: true })
    fs.writeFileSync(
      path.join(tempDir, 'fake-installed-tools.json'),
      JSON.stringify({
        'core:node': [{ version: '22.23.1', active: true }]
      })
    )
    fs.writeFileSync(path.join(shimsDir, 'node'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })

    await expect(service.installTool({ intent: { name: 'node', tool: 'core:node' } })).resolves.toEqual({
      version: '22.23.1'
    })
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('feature.binary.tools')).toEqual([
      { name: 'node', tool: 'core:node', requestedVersion: '22.23.1' }
    ])

    fs.writeFileSync(path.join(tempDir, 'fake-installed-tools.json'), 'not json')
    await expect(service.installTool({ intent: { name: 'rg', tool: 'rg' } })).rejects.toThrow()
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('feature.binary.tools')).toEqual([
      { name: 'node', tool: 'core:node', requestedVersion: '22.23.1' }
    ])
  })
})
