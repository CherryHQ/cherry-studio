import { describe, expect, it } from 'vitest'

import { resolveAgentMcpToolExposure } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'

import { buildAgentConfigInstructions } from './agentConfigInstructions'

function configInstructions(
  agent: Parameters<typeof resolveAgentMcpToolExposure>[0],
  { channelLinked = false, blocked = [] }: { channelLinked?: boolean; blocked?: string[] } = {}
) {
  const { allowsTool } = resolveAgentMcpToolExposure(agent, { channelLinked })
  return buildAgentConfigInstructions((server, tool) => {
    const id = `${server}/${tool}`
    return allowsTool(server, tool) && !blocked.includes(id) ? `<${id}>` : undefined
  }, 'RUNTIME_HINT.')
}

describe('Agent configuration instructions', () => {
  it('sends a user-created Agent to its own create and settings tools, in the runtime call form', () => {
    const prompt = configInstructions({ type: 'pi', configuration: {} })

    expect(prompt).toContain('<cherry-tools/agent_create>')
    expect(prompt).toContain('<cherry-tools/assistant_create>')
    expect(prompt).toContain('<cherry-tools/config_update>')
    expect(prompt).toContain('RUNTIME_HINT.')
  })

  // With the settings named only in prose, Kimi K2.6 guessed reply_language, permission_mode and system_prompt.
  it.each([
    [
      'a user-created Agent',
      {},
      'cherry-tools/agent_create',
      'cherry-tools/assistant_create',
      'cherry-tools/config_update'
    ],
    [
      'Cherry Assistant',
      { builtin_role: BUILTIN_AGENT_ROLE.ASSISTANT },
      'assistant/create_agent',
      'assistant/create_assistant',
      'assistant/update_agent'
    ]
  ])('spells out the real argument names for %s', (_name, configuration, createAgent, createAssistant, update) => {
    const prompt = configInstructions({ type: 'pi', configuration }) ?? ''
    const argsOf = (tool: string) =>
      prompt.match(new RegExp(`<${tool}>[^\`]*\`\\{ ([^}]*) \\}\``))?.[1].split(', ') ?? []

    expect(argsOf(createAgent)).toEqual(
      expect.arrayContaining(['name', 'instructions', 'permissionMode?', 'language?'])
    )
    expect(argsOf(createAssistant)).toEqual(expect.arrayContaining(['name', 'prompt', 'emoji?']))
    expect(argsOf(createAssistant)).not.toContain('instructions')
    expect(argsOf(update)).toEqual(expect.arrayContaining(['permissionMode?', 'language?', 'instructions?']))
    expect(prompt).not.toContain('cherryApprovalExecution')
  })

  // "创建一个定时任务" is the Agent's own scheduled work, not a request for a new Agent.
  it.each([
    ['a user-created Agent', {}],
    ['Cherry Assistant', { builtin_role: BUILTIN_AGENT_ROLE.ASSISTANT }]
  ])('sends %s to cron for scheduled work instead of the create tools', (_name, configuration) => {
    const prompt = configInstructions({ type: 'claude-code', configuration })

    expect(prompt).toContain('<cherry-tools/cron>')
  })

  // Catches guidance naming a tool the Agent disabled, which the runtime refuses when the model calls it.
  it.each([
    ['config_update', 'cherry-tools/config_update', ['<cherry-tools/agent_create>', '<cherry-tools/assistant_create>']],
    ['agent_create', 'cherry-tools/agent_create', ['<cherry-tools/assistant_create>', '<cherry-tools/config_update>']],
    ['cron', 'cherry-tools/cron', ['<cherry-tools/agent_create>']]
  ])('leaves out a disabled %s and keeps the tools still available', (_tool, disabled, kept) => {
    const prompt = configInstructions({ type: 'pi-durable', configuration: {} }, { blocked: [disabled] }) ?? ''

    expect(prompt).not.toContain(`<${disabled}>`)
    for (const tool of kept) expect(prompt).toContain(tool)
  })

  it('gives no guidance when every create and settings tool is disabled', () => {
    expect(
      configInstructions(
        { type: 'pi-durable', configuration: {} },
        { blocked: ['cherry-tools/agent_create', 'cherry-tools/assistant_create', 'cherry-tools/config_update'] }
      )
    ).toBeUndefined()
  })

  // Catches cron attached to every non-create request, which can persist a job for work meant to run now.
  it('asks for cron only for a scheduled or recurring request', () => {
    const prompt = configInstructions({ type: 'pi', configuration: {} }) ?? ''
    const sentences = prompt.split(/(?<=\.)\s+/)

    expect(sentences.find((sentence) => sentence.includes('<cherry-tools/cron>'))).toMatch(
      /^When the user asks for a scheduled or recurring task/
    )
  })

  it('points Cherry Assistant at its host create and update tools', () => {
    const prompt = configInstructions({
      type: 'claude-code',
      configuration: { builtin_role: BUILTIN_AGENT_ROLE.ASSISTANT }
    })

    expect(prompt).toContain('<assistant/create_agent>')
    expect(prompt).toContain('<assistant/create_assistant>')
    expect(prompt).toContain('<assistant/update_agent>')
    expect(prompt).not.toContain('config_update')
  })

  it('keeps the available host create tool and omits update when agent lookup is blocked', () => {
    const prompt = configInstructions(
      { type: 'claude-code', configuration: { builtin_role: BUILTIN_AGENT_ROLE.ASSISTANT } },
      { blocked: ['assistant/create_agent', 'cherry-tools/agent_list'] }
    )
    expect(prompt).toContain('asks for a new Assistant')
    expect(prompt).toContain('<assistant/create_assistant>')
    expect(prompt).not.toContain('<assistant/create_agent>')
    expect(prompt).not.toContain('<assistant/update_agent>')
  })

  // A channel-linked Cherry Assistant session leaves the assistant server unmounted.
  it('names no tools a channel-linked Cherry Assistant session does not mount', () => {
    expect(
      configInstructions(
        { type: 'claude-code', configuration: { builtin_role: BUILTIN_AGENT_ROLE.ASSISTANT } },
        { channelLinked: true }
      )
    ).toBeUndefined()
  })

  it.each([BUILTIN_AGENT_ROLE.SUPPORT, BUILTIN_AGENT_ROLE.DOCTOR])(
    'adds no create guidance for the built-in %s Agent, which mounts no create tools',
    (role) => {
      expect(configInstructions({ type: 'claude-code', configuration: { builtin_role: role } })).toBeUndefined()
    }
  )
})
