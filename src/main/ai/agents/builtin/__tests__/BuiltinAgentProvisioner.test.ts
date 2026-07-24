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

import {
  getBuiltinAgentPluginDirectory,
  loadBuiltinAgentDefinition,
  provisionBuiltinAgent
} from '../BuiltinAgentProvisioner'

const TEMPLATE_AGENT_JSON = JSON.stringify({
  name: { 'en-US': 'Cherry Assistant', 'zh-CN': 'Cherry Assistant CN' },
  instructions: { 'en-US': 'English instructions', 'zh-CN': 'Chinese instructions' },
  configuration: { permission_mode: 'default' },
  skills: ['cherry-assistant-guide']
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

    writeFile(path.join(templateDir, '.claude', '.claude-plugin', 'plugin.json'), '{"name":"builtin-test"}')
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

  it('loads bundled skills from the app-owned plugin directory', () => {
    expect(getBuiltinAgentPluginDirectory('assistant')).toBe(path.join(templateDir, '.claude'))
    expect(loadBuiltinAgentDefinition('assistant')?.skills).toEqual(['cherry-assistant-guide'])
  })

  it('copies persona and memory templates into a system workspace without copying product files', async () => {
    const result = await provisionBuiltinAgent({ path: workspace, type: 'system' }, 'assistant')

    expect(fs.existsSync(path.join(workspace, '.claude'))).toBe(false)
    expect(fs.readFileSync(path.join(workspace, 'SOUL.md'), 'utf-8')).toBe('TEMPLATE_SOUL')
    expect(fs.readFileSync(path.join(workspace, 'USER.md'), 'utf-8')).toBe('TEMPLATE_USER')
    expect(fs.readFileSync(path.join(workspace, 'memory', 'FACT.md'), 'utf-8')).toBe('TEMPLATE_FACT')
    expect(result).toEqual({
      name: 'Cherry Assistant',
      instructions: 'English instructions',
      configuration: { permission_mode: 'default' },
      skills: ['cherry-assistant-guide']
    })
  })

  it('does not modify a user workspace', async () => {
    writeFile(path.join(workspace, '.claude', 'plugins.json'), 'USER_PLUGINS')

    const result = await provisionBuiltinAgent({ path: workspace, type: 'user' }, 'assistant')

    expect(fs.readFileSync(path.join(workspace, '.claude', 'plugins.json'), 'utf-8')).toBe('USER_PLUGINS')
    expect(fs.existsSync(path.join(workspace, 'SOUL.md'))).toBe(false)
    expect(fs.existsSync(path.join(workspace, 'memory'))).toBe(false)
    expect(result?.skills).toEqual(['cherry-assistant-guide'])
  })

  it('preserves user-owned persona and memory files across provisioning', async () => {
    await provisionBuiltinAgent({ path: workspace, type: 'system' }, 'assistant')
    fs.writeFileSync(path.join(workspace, 'SOUL.md'), 'CUSTOM_SOUL')
    fs.writeFileSync(path.join(workspace, 'USER.md'), 'CUSTOM_USER')
    fs.writeFileSync(path.join(workspace, 'memory', 'FACT.md'), 'CUSTOM_FACT')

    await provisionBuiltinAgent({ path: workspace, type: 'system' }, 'assistant')

    expect(fs.readFileSync(path.join(workspace, 'SOUL.md'), 'utf-8')).toBe('CUSTOM_SOUL')
    expect(fs.readFileSync(path.join(workspace, 'USER.md'), 'utf-8')).toBe('CUSTOM_USER')
    expect(fs.readFileSync(path.join(workspace, 'memory', 'FACT.md'), 'utf-8')).toBe('CUSTOM_FACT')
  })

  it('returns undefined for unknown builtin roles', async () => {
    expect(await provisionBuiltinAgent({ path: workspace, type: 'system' }, 'skill-creator')).toBeUndefined()
    expect(fs.existsSync(path.join(workspace, '.claude'))).toBe(false)
  })

  it('returns undefined when the template directory is missing', async () => {
    fs.rmSync(templateDir, { recursive: true })

    expect(await provisionBuiltinAgent({ path: workspace, type: 'system' }, 'assistant')).toBeUndefined()
    expect(fs.existsSync(path.join(workspace, '.claude'))).toBe(false)
  })

  it('does not initialize a workspace when agent.json is malformed', async () => {
    fs.writeFileSync(path.join(templateDir, 'agent.json'), '{not json')

    expect(await provisionBuiltinAgent({ path: workspace, type: 'system' }, 'assistant')).toBeUndefined()
    expect(fs.existsSync(path.join(workspace, 'SOUL.md'))).toBe(false)
  })
})
