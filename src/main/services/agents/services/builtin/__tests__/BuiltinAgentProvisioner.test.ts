import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// The main test setup mocks node:fs/os/path globally — un-mock them here so the
// provisioner can do real filesystem work against tmp directories.
vi.mock('node:fs', async () => await vi.importActual('node:fs'))
vi.mock('node:os', async () => await vi.importActual('node:os'))
vi.mock('node:path', async () => await vi.importActual('node:path'))
vi.mock('fs', async () => await vi.importActual('fs'))
vi.mock('os', async () => await vi.importActual('os'))
vi.mock('path', async () => await vi.importActual('path'))

const { mockGetResourcePath, mockGetLanguage } = vi.hoisted(() => ({
  mockGetResourcePath: vi.fn(),
  mockGetLanguage: vi.fn()
}))

vi.mock('@main/utils', () => ({
  getResourcePath: mockGetResourcePath
}))

vi.mock('@main/services/ConfigManager', () => ({
  configManager: {
    getLanguage: mockGetLanguage
  }
}))

import fs from 'fs'
import os from 'os'
import path from 'path'

import { isProvisioned, provisionBuiltinAgent } from '../BuiltinAgentProvisioner'

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

const TEMPLATE_AGENT_JSON = JSON.stringify({
  name: { 'en-US': 'Cherry Assistant', 'zh-CN': 'Cherry 小助手' },
  description: { 'en-US': 'desc-en', 'zh-CN': 'desc-zh' },
  instructions: { 'en-US': 'inst-en', 'zh-CN': 'inst-zh' },
  configuration: { permission_mode: 'default', avatar: '🍒' }
})

describe('provisionBuiltinAgent', () => {
  let resourceRoot: string
  let templateDir: string
  let workspace: string

  beforeEach(() => {
    resourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'provisioner-resource-'))
    templateDir = path.join(resourceRoot, 'builtin-agents', 'cherry-assistant')
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'provisioner-workspace-'))

    // Seed a complete template
    writeFile(path.join(templateDir, '.claude', 'skills', 'cherry-assistant-guide', 'SKILL.md'), 'TEMPLATE_SKILL_V1')
    writeFile(path.join(templateDir, '.claude', 'plugins.json'), '{"plugins":[]}')
    writeFile(path.join(templateDir, 'SOUL.md'), 'TEMPLATE_SOUL')
    writeFile(path.join(templateDir, 'USER.md'), 'TEMPLATE_USER')
    writeFile(path.join(templateDir, 'memory', 'FACT.md'), 'TEMPLATE_FACT')
    writeFile(path.join(templateDir, 'agent.json'), TEMPLATE_AGENT_JSON)

    mockGetResourcePath.mockReturnValue(resourceRoot)
    mockGetLanguage.mockReturnValue('en-US')
  })

  afterEach(() => {
    fs.rmSync(resourceRoot, { recursive: true, force: true })
    fs.rmSync(workspace, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  it('copies the full template into an empty workspace on first provision', async () => {
    const result = await provisionBuiltinAgent(workspace, 'assistant')

    expect(
      fs.readFileSync(path.join(workspace, '.claude', 'skills', 'cherry-assistant-guide', 'SKILL.md'), 'utf-8')
    ).toBe('TEMPLATE_SKILL_V1')
    expect(fs.readFileSync(path.join(workspace, '.claude', 'plugins.json'), 'utf-8')).toBe('{"plugins":[]}')
    expect(fs.readFileSync(path.join(workspace, 'SOUL.md'), 'utf-8')).toBe('TEMPLATE_SOUL')
    expect(fs.readFileSync(path.join(workspace, 'USER.md'), 'utf-8')).toBe('TEMPLATE_USER')
    expect(fs.readFileSync(path.join(workspace, 'memory', 'FACT.md'), 'utf-8')).toBe('TEMPLATE_FACT')

    expect(result).toEqual({
      name: 'Cherry Assistant',
      description: 'desc-en',
      instructions: 'inst-en',
      configuration: { permission_mode: 'default', avatar: '🍒' }
    })
  })

  it('overwrites .claude/ on every call (product-managed knowledge updates)', async () => {
    await provisionBuiltinAgent(workspace, 'assistant')
    // Simulate an app upgrade that ships a new SKILL.md
    writeFile(path.join(templateDir, '.claude', 'skills', 'cherry-assistant-guide', 'SKILL.md'), 'TEMPLATE_SKILL_V2')

    await provisionBuiltinAgent(workspace, 'assistant')

    expect(
      fs.readFileSync(path.join(workspace, '.claude', 'skills', 'cherry-assistant-guide', 'SKILL.md'), 'utf-8')
    ).toBe('TEMPLATE_SKILL_V2')
  })

  it('preserves user-modified SOUL.md, USER.md, and memory/ across re-provisioning', async () => {
    await provisionBuiltinAgent(workspace, 'assistant')

    // User customizes their persona, profile, and memory
    fs.writeFileSync(path.join(workspace, 'SOUL.md'), 'USER_CUSTOM_SOUL')
    fs.writeFileSync(path.join(workspace, 'USER.md'), 'USER_CUSTOM_USER')
    fs.writeFileSync(path.join(workspace, 'memory', 'FACT.md'), 'USER_CUSTOM_FACT')

    await provisionBuiltinAgent(workspace, 'assistant')

    expect(fs.readFileSync(path.join(workspace, 'SOUL.md'), 'utf-8')).toBe('USER_CUSTOM_SOUL')
    expect(fs.readFileSync(path.join(workspace, 'USER.md'), 'utf-8')).toBe('USER_CUSTOM_USER')
    expect(fs.readFileSync(path.join(workspace, 'memory', 'FACT.md'), 'utf-8')).toBe('USER_CUSTOM_FACT')
  })

  it('resolves localized fields based on configManager.getLanguage()', async () => {
    mockGetLanguage.mockReturnValue('zh-CN')

    const result = await provisionBuiltinAgent(workspace, 'assistant')

    expect(result?.name).toBe('Cherry 小助手')
    expect(result?.description).toBe('desc-zh')
    expect(result?.instructions).toBe('inst-zh')
  })

  it('returns undefined and logs a warning for unknown builtin roles', async () => {
    const result = await provisionBuiltinAgent(workspace, 'skill-creator')

    expect(result).toBeUndefined()
    expect(fs.existsSync(path.join(workspace, '.claude'))).toBe(false)
  })

  it('returns undefined when the template directory is missing', async () => {
    fs.rmSync(templateDir, { recursive: true })

    const result = await provisionBuiltinAgent(workspace, 'assistant')

    expect(result).toBeUndefined()
    expect(fs.existsSync(path.join(workspace, '.claude'))).toBe(false)
  })

  it('does not throw on malformed agent.json — returns undefined', async () => {
    fs.writeFileSync(path.join(templateDir, 'agent.json'), '{not json')

    const result = await provisionBuiltinAgent(workspace, 'assistant')

    expect(result).toBeUndefined()
    // .claude/ still gets copied because the JSON.parse failure happens after
    expect(fs.existsSync(path.join(workspace, '.claude', 'skills'))).toBe(true)
  })
})

describe('isProvisioned', () => {
  let workspace: string

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'provisioner-isprov-'))
  })

  afterEach(() => {
    fs.rmSync(workspace, { recursive: true, force: true })
  })

  it('returns false for an empty workspace', () => {
    expect(isProvisioned(workspace)).toBe(false)
  })

  it('returns true when .claude/skills/ exists', () => {
    fs.mkdirSync(path.join(workspace, '.claude', 'skills'), { recursive: true })
    expect(isProvisioned(workspace)).toBe(true)
  })
})
