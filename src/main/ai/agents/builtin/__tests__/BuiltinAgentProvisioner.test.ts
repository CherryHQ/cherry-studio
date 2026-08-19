import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { application } from '@application'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { app } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  toAsarUnpackedPath: vi.fn((filePath: string) => filePath)
}))

vi.mock('@main/utils/asar', () => ({
  toAsarUnpackedPath: mocks.toAsarUnpackedPath
}))

import { BUILTIN_AGENT_PLUGIN_NAME, loadBuiltinAgentDefaults } from '../builtinAgentDefinition'
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
const SUPPORT_AGENT_JSON = JSON.stringify({
  name: { 'en-US': 'Cherry Support', 'zh-CN': 'Cherry Support CN' },
  instructions: { 'en-US': 'Support instructions', 'zh-CN': 'Chinese support instructions' },
  configuration: { permission_mode: 'acceptEdits' },
  skills: ['cherry-assistant-guide', 'faq-collector', 'cherry-studio-feedback', 'issue-reporter']
})
const RC5_STOCK_SOUL_PATH = fileURLToPath(new URL('./fixtures/cherry-assistant-rc5-soul.md', import.meta.url))
const PR17870_INTERIM_STOCK_SOUL_PATH = fileURLToPath(
  new URL('./fixtures/cherry-assistant-pr17870-interim-soul.md', import.meta.url)
)

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

describe('BuiltinAgentProvisioner', () => {
  let templateRoot: string
  let templateDir: string
  let agentDataPath: string

  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
    mocks.toAsarUnpackedPath.mockClear()
    templateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'builtin-agent-template-'))
    templateDir = path.join(templateRoot, 'cherry-assistant')
    agentDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'builtin-agent-data-'))

    vi.spyOn(application, 'getPath').mockReturnValue(templateRoot)
    vi.mocked(app.getLocale).mockReturnValue('en-US')

    writeFile(path.join(templateDir, '.claude', '.claude-plugin', 'plugin.json'), '{"name":"cherry-assistant-builtin"}')
    writeFile(path.join(templateDir, '.claude', 'skills', 'cherry-assistant-guide', 'SKILL.md'), 'SKILL_V1')
    writeFile(path.join(templateDir, 'SOUL.md'), 'TEMPLATE_SOUL')
    writeFile(path.join(templateDir, 'USER.md'), 'TEMPLATE_USER')
    writeFile(path.join(templateDir, 'memory', 'FACT.md'), 'TEMPLATE_FACT')
    writeFile(path.join(templateDir, 'agent.json'), TEMPLATE_AGENT_JSON)
    writeFile(path.join(templateRoot, 'cherry-support', 'SOUL.md'), 'SUPPORT_SOUL')
    writeFile(path.join(templateRoot, 'cherry-support', 'USER.md'), 'SUPPORT_USER')
    writeFile(path.join(templateRoot, 'cherry-support', 'memory', 'FACT.md'), 'SUPPORT_FACT')
    writeFile(path.join(templateRoot, 'cherry-support', 'agent.json'), SUPPORT_AGENT_JSON)
  })

  afterEach(() => {
    fs.rmSync(templateRoot, { recursive: true, force: true })
    fs.rmSync(agentDataPath, { recursive: true, force: true })
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
    expect(mocks.toAsarUnpackedPath).toHaveBeenCalledWith(path.join(templateDir, '.claude'))
    expect(loadBuiltinAgentDefinition('assistant')?.skills).toEqual(['cherry-assistant-guide'])
  })

  it('keeps the canonical bundled plugin name aligned with its manifest', () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(templateDir, '.claude', '.claude-plugin', 'plugin.json'), 'utf-8')
    )
    expect(manifest.name).toBe(BUILTIN_AGENT_PLUGIN_NAME)
  })

  it('loads Cherry Support identity from its own package and plugins from Cherry Assistant', () => {
    expect(loadBuiltinAgentDefinition('support')).toMatchObject({
      name: 'Cherry Support',
      instructions: 'Support instructions',
      skills: ['cherry-assistant-guide', 'faq-collector', 'cherry-studio-feedback', 'issue-reporter']
    })
    expect(getBuiltinAgentPluginDirectory('support')).toBe(path.join(templateDir, '.claude'))
  })

  it('builds creation defaults from the bundled Agent definition', () => {
    expect(loadBuiltinAgentDefaults('assistant')).toEqual({
      name: 'Cherry Assistant',
      configuration: { permission_mode: 'default', builtin_role: 'assistant' }
    })
  })

  it('rejects invalid bundled creation defaults', () => {
    writeFile(
      path.join(templateDir, 'agent.json'),
      JSON.stringify({ name: 'Cherry Assistant', configuration: { permission_mode: 'invalid' } })
    )

    expect(() => loadBuiltinAgentDefaults('assistant')).toThrow(
      'Builtin Agent package configuration is invalid for assistant'
    )
  })

  it('copies persona and memory templates into agent data without copying product files', async () => {
    const result = await provisionBuiltinAgent(agentDataPath, 'assistant')

    expect(fs.existsSync(path.join(agentDataPath, '.claude'))).toBe(false)
    expect(fs.readFileSync(path.join(agentDataPath, 'SOUL.md'), 'utf-8')).toBe('TEMPLATE_SOUL')
    expect(fs.readFileSync(path.join(agentDataPath, 'USER.md'), 'utf-8')).toBe('TEMPLATE_USER')
    expect(fs.readFileSync(path.join(agentDataPath, 'memory', 'FACT.md'), 'utf-8')).toBe('TEMPLATE_FACT')
    expect(result).toEqual({
      name: 'Cherry Assistant',
      instructions: 'English instructions',
      configuration: { permission_mode: 'default' },
      skills: ['cherry-assistant-guide']
    })
  })

  it('initializes empty persona placeholders from the bundled templates', async () => {
    writeFile(path.join(agentDataPath, 'SOUL.md'), '')
    writeFile(path.join(agentDataPath, 'USER.md'), '')

    await provisionBuiltinAgent(agentDataPath, 'assistant')

    expect(fs.readFileSync(path.join(agentDataPath, 'SOUL.md'), 'utf-8')).toBe('TEMPLATE_SOUL')
    expect(fs.readFileSync(path.join(agentDataPath, 'USER.md'), 'utf-8')).toBe('TEMPLATE_USER')
  })

  it('migrates the exact restrictive SOUL.md bundled in v2.0.0-rc.5', async () => {
    writeFile(path.join(agentDataPath, 'SOUL.md'), fs.readFileSync(RC5_STOCK_SOUL_PATH, 'utf-8'))

    await provisionBuiltinAgent(agentDataPath, 'assistant')

    expect(fs.readFileSync(path.join(agentDataPath, 'SOUL.md'), 'utf-8')).toBe('TEMPLATE_SOUL')
  })

  it('migrates the exact interim SOUL.md bundled during PR #17870', async () => {
    writeFile(path.join(agentDataPath, 'SOUL.md'), fs.readFileSync(PR17870_INTERIM_STOCK_SOUL_PATH, 'utf-8'))

    await provisionBuiltinAgent(agentDataPath, 'assistant')

    expect(fs.readFileSync(path.join(agentDataPath, 'SOUL.md'), 'utf-8')).toBe('TEMPLATE_SOUL')
  })

  it('preserves a user edit made to the legacy bundled SOUL.md', async () => {
    const stockSoul = fs.readFileSync(RC5_STOCK_SOUL_PATH, 'utf-8')
    const customizedSoul = stockSoul.replace('warm, patient', 'warm, direct ')
    expect(Buffer.byteLength(customizedSoul)).toBe(Buffer.byteLength(stockSoul))
    writeFile(path.join(agentDataPath, 'SOUL.md'), customizedSoul)

    await provisionBuiltinAgent(agentDataPath, 'assistant')

    expect(fs.readFileSync(path.join(agentDataPath, 'SOUL.md'), 'utf-8')).toBe(customizedSoul)
  })

  it('initializes missing memory templates after the agent data directory creates memory', async () => {
    fs.mkdirSync(path.join(agentDataPath, 'memory'), { recursive: true })

    await provisionBuiltinAgent(agentDataPath, 'assistant')

    expect(fs.readFileSync(path.join(agentDataPath, 'memory', 'FACT.md'), 'utf-8')).toBe('TEMPLATE_FACT')
  })

  it('preserves user-owned persona and memory files across provisioning', async () => {
    await provisionBuiltinAgent(agentDataPath, 'assistant')
    fs.writeFileSync(path.join(agentDataPath, 'SOUL.md'), 'CUSTOM_SOUL')
    fs.writeFileSync(path.join(agentDataPath, 'USER.md'), 'CUSTOM_USER')
    fs.writeFileSync(path.join(agentDataPath, 'memory', 'FACT.md'), 'CUSTOM_FACT')

    await provisionBuiltinAgent(agentDataPath, 'assistant')

    expect(fs.readFileSync(path.join(agentDataPath, 'SOUL.md'), 'utf-8')).toBe('CUSTOM_SOUL')
    expect(fs.readFileSync(path.join(agentDataPath, 'USER.md'), 'utf-8')).toBe('CUSTOM_USER')
    expect(fs.readFileSync(path.join(agentDataPath, 'memory', 'FACT.md'), 'utf-8')).toBe('CUSTOM_FACT')
  })

  it('returns undefined for unknown builtin roles', async () => {
    expect(await provisionBuiltinAgent(agentDataPath, 'skill-creator')).toBeUndefined()
    expect(fs.existsSync(path.join(agentDataPath, '.claude'))).toBe(false)
  })

  it('returns undefined when the template directory is missing', async () => {
    fs.rmSync(templateDir, { recursive: true })

    expect(await provisionBuiltinAgent(agentDataPath, 'assistant')).toBeUndefined()
    expect(fs.existsSync(path.join(agentDataPath, '.claude'))).toBe(false)
  })

  it('does not initialize agent data when agent.json is malformed', async () => {
    fs.writeFileSync(path.join(templateDir, 'agent.json'), '{not json')

    expect(await provisionBuiltinAgent(agentDataPath, 'assistant')).toBeUndefined()
    expect(fs.existsSync(path.join(agentDataPath, 'SOUL.md'))).toBe(false)
  })
})
