import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { loadBuiltinAgentDefinition } from '@main/ai/agents/builtin/builtinAgentDefinition'
import type { AgentEntity } from '@shared/data/api/schemas/agents'

import { buildAgentRuntimePrompt } from '../agentPrompt'

// Historical stock: 3b7a1c5ca6^ resources/builtin-agents/cherry-assistant/agent.json
const stock = JSON.parse(
  fs.readFileSync(new URL('./fixtures/cherry-assistant-3b7a1c5ca6-parent-instructions.json', import.meta.url), 'utf8')
).instructions as { 'en-US': string; 'zh-CN': string }

const REFUSAL = '不给代码层面的解释'

function agentOf(role: string | undefined, instructions: string): AgentEntity {
  return {
    id: 'agent-1',
    type: 'claude-code',
    name: 'Cherry Assistant',
    description: '',
    instructions,
    model: null,
    disabledTools: [],
    configuration: role ? { builtin_role: role } : {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    orderKey: 'a0',
    modelName: null
  } as AgentEntity
}

function instructionsBody(append: string): string {
  const match = append.match(/<agent_instructions>\n([\s\S]*)\n<\/agent_instructions>/)
  if (!match) throw new Error('agent instructions missing')
  return match[1]
}

describe('legacy restrictive Cherry Assistant instructions', () => {
  let workspacePath: string
  let agentDataPath: string
  let current: string

  beforeEach(() => {
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
    workspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-prompt-workspace-'))
    agentDataPath = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-prompt-data-'))
    vi.spyOn(application, 'getPath').mockImplementation((key: string) =>
      key === 'feature.agents.builtin' ? path.resolve('resources/builtin-agents') : workspacePath
    )
    current = loadBuiltinAgentDefinition('assistant')?.instructions ?? ''
    expect(current).toContain('complete any request using the available tools')
  })

  afterEach(() => {
    fs.rmSync(workspacePath, { recursive: true, force: true })
    fs.rmSync(agentDataPath, { recursive: true, force: true })
    vi.restoreAllMocks()
  })

  async function resolve(role: string | undefined, instructions: string): Promise<string> {
    const prompt = await buildAgentRuntimePrompt({
      workspacePath,
      agentDataPath,
      agent: agentOf(role, instructions),
      effectiveLanguage: null
    })
    return instructionsBody(prompt.append)
  }

  it('replaces both shipped restrictive stocks with the current bundled prompt', async () => {
    for (const text of [stock['en-US'], stock['zh-CN']]) {
      const resolved = await resolve('assistant', text)
      expect(resolved).toBe(current)
      expect(resolved).not.toContain(REFUSAL)
      expect(resolved).not.toContain('not code-level explanations')
    }
  })

  it('keeps a one-character edit and other custom text byte for byte', async () => {
    const edited = `${stock['zh-CN'].slice(0, -1)}。`
    expect(edited).not.toBe(stock['zh-CN'])
    expect(await resolve('assistant', edited)).toBe(edited)
    expect(await resolve('assistant', 'Design the mini app.')).toBe('Design the mini app.')
  })

  it('leaves the same stock on another builtin role and still loads the bundle when blank', async () => {
    expect(await resolve('support', stock['zh-CN'])).toBe(stock['zh-CN'])
    expect(await resolve('assistant', '')).toBe(current)
    expect(await resolve('assistant', stock['en-US'] + ' ')).toBe(stock['en-US'] + ' ')
  })
})
