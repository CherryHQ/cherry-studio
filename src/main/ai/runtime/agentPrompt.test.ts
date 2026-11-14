import '@data/services/AgentGlobalSkillService'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { setupTestDatabase } from '@test-helpers/db'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentService } from '@data/services/AgentService'
import { createAgentDataDirectory } from '@main/ai/agents/agentDataDirectory'
import { PromptBuilder } from '@main/ai/agents/prompt'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'

import { buildAgentRuntimePrompt, getConfigToolsPrompt } from './agentPrompt'

describe('Agent prompt onboarding', () => {
  const dbh = setupTestDatabase()
  const model = 'identity-test::test-model'
  let root: string
  let workspacePath: string

  beforeEach(async () => {
    dbh.db.insert(userProviderTable).values({ providerId: 'identity-test', name: 'Test', orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: model,
        providerId: 'identity-test',
        modelId: 'test-model',
        name: 'Test',
        capabilities: [],
        supportsStreaming: true,
        orderKey: 'a0'
      })
      .run()
    root = await mkdtemp(path.join(os.tmpdir(), 'agent-prompt-'))
    workspacePath = path.join(root, 'workspace')
    await mkdir(workspacePath)
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it.each([undefined, ''])('discovers the role when created with instructions=%j', async (instructions) => {
    const id = randomUUID()
    const agentDataPath = await createAgentDataDirectory(root, id)
    agentService.createAgentWithId(id, { type: 'claude-code', name: 'New Agent', model, instructions })
    const agent = agentService.getAgent(id)!

    expect(agent.instructions).toBe('')
    const { append } = await buildAgentRuntimePrompt({ workspacePath, agentDataPath, agent })

    expect(append).toContain('## Bootstrap Mode')
    expect(append).toContain('**Discover the role**')
    expect(append).not.toContain('<agent_instructions>')
    expect(append).toContain(path.join(agentDataPath, 'SOUL.md'))
    expect(append).toContain(path.join(agentDataPath, 'USER.md'))
  })

  it('personalizes a new Agent with a configured role without replacing that role', async () => {
    const id = randomUUID()
    const agentDataPath = await createAgentDataDirectory(root, id)
    agentService.createAgentWithId(id, {
      type: 'pi',
      name: 'Researcher',
      model,
      instructions: 'Research primary sources and cite evidence.'
    })
    const agent = agentService.getAgent(id)!
    const { append } = await buildAgentRuntimePrompt({ workspacePath, agentDataPath, agent })

    expect(append).toContain('<agent_instructions>\nResearch primary sources and cite evidence.\n</agent_instructions>')
    expect(append).toContain('## Bootstrap Mode')
    expect(append).toContain('**Discover your presentation**')
    expect(append).not.toContain('**Discover the role**')
  })

  it('loads an established identity from Agent storage without restarting onboarding', async () => {
    const id = randomUUID()
    const agentDataPath = await createAgentDataDirectory(root, id)
    const soul = 'My name is Cedar. I communicate warmly, give direct answers, and keep explanations concise.'
    await writeFile(path.join(agentDataPath, 'SOUL.md'), soul)
    await writeFile(path.join(agentDataPath, 'USER.md'), 'Call the user Lin. They prefer Chinese.')
    await writeFile(path.join(agentDataPath, 'memory', 'FACT.md'), 'The project is called Orchard.')
    await writeFile(path.join(workspacePath, 'SOUL.md'), 'Unrelated workspace identity')
    const agent = agentService.createAgentWithId(id, {
      type: 'claude-code',
      name: 'Researcher',
      model,
      instructions: 'Research primary sources.'
    })

    const { append } = await buildAgentRuntimePrompt({ workspacePath, agentDataPath, agent })

    expect(append).not.toContain('## Bootstrap Mode')
    const identity = await new PromptBuilder().buildMemoriesSection(agentDataPath)
    expect(append).not.toContain(soul)
    expect(identity).toContain(`<soul>\n${soul}\n</soul>`)
    expect(identity).toContain('<user>\nCall the user Lin. They prefer Chinese.\n</user>')
    expect(identity).toContain('<facts>\nThe project is called Orchard.\n</facts>')
    expect(identity).not.toContain('Unrelated workspace identity')
  })

  it('tells a user-created Agent it can create Agents and Assistants and change its own settings', async () => {
    const id = randomUUID()
    const agentDataPath = await createAgentDataDirectory(root, id)
    agentService.createAgentWithId(id, { type: 'pi-durable', name: 'Helper', model, instructions: 'Help.' })

    const { append } = await buildAgentRuntimePrompt({
      workspacePath,
      agentDataPath,
      agent: agentService.getAgent(id)!
    })

    expect(append).toContain('`await tools.mcp__cherry_tools__agent_create({ ... })`')
    expect(append).toContain('`await tools.mcp__cherry_tools__assistant_create({ ... })`')
    expect(append).toContain('`await tools.mcp__cherry_tools__config_update({ ... })`')
  })
})

describe('getConfigToolsPrompt', () => {
  // Each runtime reaches MCP tools differently; a name or path from another runtime leaves the model unable to call them.
  it.each([
    ['claude-code', '`mcp__cherry-tools__assistant_create`', '`mcp__cherry-tools__config_update`'],
    ['pi', '`mcp__cherry_tools__assistant_create`', '`mcp__cherry_tools__config_update`'],
    [
      'pi-durable',
      '`await tools.mcp__cherry_tools__assistant_create({ ... })`',
      '`await tools.mcp__cherry_tools__config_update({ ... })`'
    ]
  ] as const)('names the create and settings tools in the %s call form', (type, create, update) => {
    const prompt = getConfigToolsPrompt({ type, configuration: {} })

    expect(prompt).toContain(create)
    expect(prompt).toContain(update)
  })

  it('sends Pi to tool_search, Pi Durable to codemode, and Claude Code to neither', () => {
    expect(getConfigToolsPrompt({ type: 'pi', configuration: {} })).toContain('load them with `tool_search`')
    expect(getConfigToolsPrompt({ type: 'pi-durable', configuration: {} })).toContain(
      'run them inside a `codemode` script'
    )
    expect(getConfigToolsPrompt({ type: 'claude-code', configuration: {} })).not.toMatch(/tool_search|codemode/)
  })

  it('points Cherry Assistant at its host create and update tools', () => {
    const prompt = getConfigToolsPrompt({
      type: 'claude-code',
      configuration: { builtin_role: BUILTIN_AGENT_ROLE.ASSISTANT }
    })

    expect(prompt).toContain('`mcp__assistant__create_agent`')
    expect(prompt).toContain('`mcp__assistant__create_assistant`')
    expect(prompt).toContain('`mcp__assistant__update_agent`')
    expect(prompt).not.toContain('config_update')
  })

  it.each([BUILTIN_AGENT_ROLE.SUPPORT, BUILTIN_AGENT_ROLE.DOCTOR])(
    'adds no create guidance for the built-in %s Agent, which mounts no create tools',
    (role) => {
      expect(getConfigToolsPrompt({ type: 'claude-code', configuration: { builtin_role: role } })).toBeUndefined()
    }
  )
})
