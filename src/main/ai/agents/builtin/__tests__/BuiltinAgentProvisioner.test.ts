import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { application } from '@application'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:fs', async () => await vi.importActual('node:fs'))
vi.mock('node:os', async () => await vi.importActual('node:os'))
vi.mock('node:path', async () => await vi.importActual('node:path'))
vi.mock('fs', async () => await vi.importActual('fs'))
vi.mock('os', async () => await vi.importActual('os'))
vi.mock('path', async () => await vi.importActual('path'))

import { isProvisioned, loadBuiltinAgentDefinition, provisionBuiltinAgent } from '../BuiltinAgentProvisioner'

const TEMPLATE_AGENT_JSON = JSON.stringify({
  name: { 'en-US': 'Cherry Assistant', 'zh-CN': 'Cherry Assistant CN' },
  instructions: { 'en-US': 'English instructions', 'zh-CN': 'Chinese instructions' },
  configuration: { permission_mode: 'default' }
})

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

describe('BuiltinAgentProvisioner', () => {
  let templateRoot: string
  let templateDir: string
  let workspace: string

  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
    templateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'builtin-agent-template-'))
    templateDir = path.join(templateRoot, 'cherry-assistant')
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'builtin-agent-workspace-'))

    vi.spyOn(application, 'getPath').mockReturnValue(templateRoot)
    vi.mocked(app.getLocale).mockReturnValue('en-US')

    writeFile(path.join(templateDir, '.claude', 'skills', 'cherry-assistant-guide', 'SKILL.md'), 'SKILL_V1')
    writeFile(path.join(templateDir, '.claude', 'plugins.json'), '{"plugins":[]}')
    writeFile(path.join(templateDir, 'SOUL.md'), 'TEMPLATE_SOUL')
    writeFile(path.join(templateDir, 'USER.md'), 'TEMPLATE_USER')
    writeFile(path.join(templateDir, 'memory', 'FACT.md'), 'TEMPLATE_FACT')
    writeFile(path.join(templateDir, 'agent.json'), TEMPLATE_AGENT_JSON)
  })

  afterEach(() => {
    fs.rmSync(templateRoot, { recursive: true, force: true })
    fs.rmSync(workspace, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  it('uses the system locale when app.language is unset', () => {
    vi.mocked(app.getLocale).mockReturnValue('zh-CN')

    expect(loadBuiltinAgentDefinition('assistant')).toMatchObject({
      name: 'Cherry Assistant CN',
      instructions: 'Chinese instructions'
    })
  })

  it('prefers app.language over the system locale', () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
    vi.mocked(app.getLocale).mockReturnValue('zh-CN')

    expect(loadBuiltinAgentDefinition('assistant')).toMatchObject({
      name: 'Cherry Assistant',
      instructions: 'English instructions'
    })
  })

  it('copies product and user-owned template files on first provision', async () => {
    const result = await provisionBuiltinAgent(workspace, 'assistant')

    expect(
      fs.readFileSync(path.join(workspace, '.claude', 'skills', 'cherry-assistant-guide', 'SKILL.md'), 'utf-8')
    ).toBe('SKILL_V1')
    expect(fs.readFileSync(path.join(workspace, '.claude', 'plugins.json'), 'utf-8')).toBe('{"plugins":[]}')
    expect(fs.readFileSync(path.join(workspace, 'SOUL.md'), 'utf-8')).toBe('TEMPLATE_SOUL')
    expect(fs.readFileSync(path.join(workspace, 'USER.md'), 'utf-8')).toBe('TEMPLATE_USER')
    expect(fs.readFileSync(path.join(workspace, 'memory', 'FACT.md'), 'utf-8')).toBe('TEMPLATE_FACT')
    expect(result).toEqual({
      name: 'Cherry Assistant',
      instructions: 'English instructions',
      configuration: { permission_mode: 'default' }
    })
  })

  it('overwrites product-managed .claude files on every provision', async () => {
    await provisionBuiltinAgent(workspace, 'assistant')
    writeFile(path.join(templateDir, '.claude', 'skills', 'cherry-assistant-guide', 'SKILL.md'), 'SKILL_V2')

    await provisionBuiltinAgent(workspace, 'assistant')

    expect(
      fs.readFileSync(path.join(workspace, '.claude', 'skills', 'cherry-assistant-guide', 'SKILL.md'), 'utf-8')
    ).toBe('SKILL_V2')
  })

  it('preserves user-owned persona and memory files across provisioning', async () => {
    await provisionBuiltinAgent(workspace, 'assistant')
    fs.writeFileSync(path.join(workspace, 'SOUL.md'), 'CUSTOM_SOUL')
    fs.writeFileSync(path.join(workspace, 'USER.md'), 'CUSTOM_USER')
    fs.writeFileSync(path.join(workspace, 'memory', 'FACT.md'), 'CUSTOM_FACT')

    await provisionBuiltinAgent(workspace, 'assistant')

    expect(fs.readFileSync(path.join(workspace, 'SOUL.md'), 'utf-8')).toBe('CUSTOM_SOUL')
    expect(fs.readFileSync(path.join(workspace, 'USER.md'), 'utf-8')).toBe('CUSTOM_USER')
    expect(fs.readFileSync(path.join(workspace, 'memory', 'FACT.md'), 'utf-8')).toBe('CUSTOM_FACT')
  })

  it('returns undefined for unknown builtin roles', async () => {
    expect(await provisionBuiltinAgent(workspace, 'skill-creator')).toBeUndefined()
    expect(fs.existsSync(path.join(workspace, '.claude'))).toBe(false)
  })

  it('returns undefined when the template directory is missing', async () => {
    fs.rmSync(templateDir, { recursive: true })

    expect(await provisionBuiltinAgent(workspace, 'assistant')).toBeUndefined()
    expect(fs.existsSync(path.join(workspace, '.claude'))).toBe(false)
  })

  it('still copies product files when agent.json is malformed', async () => {
    fs.writeFileSync(path.join(templateDir, 'agent.json'), '{not json')

    expect(await provisionBuiltinAgent(workspace, 'assistant')).toBeUndefined()
    expect(fs.existsSync(path.join(workspace, '.claude', 'skills'))).toBe(true)
  })

  it('detects whether the workspace has provisioned skills', () => {
    expect(isProvisioned(workspace)).toBe(false)

    fs.mkdirSync(path.join(workspace, '.claude', 'skills'), { recursive: true })

    expect(isProvisioned(workspace)).toBe(true)
  })
})
