import { describe, expect, it } from 'vitest'

import { BUILTIN_AGENT_ROLE } from '@shared/ai/builtinAgent'

import { buildConfigToolsGuidance, buildReportArtifactsGuidance } from './configToolsGuidance'

const callForm = { ref: (server: string, name: string) => `<${server}/${name}>`, hint: ' RUNTIME_HINT.' }

describe('buildConfigToolsGuidance', () => {
  it('sends a user-created Agent to its own create and settings tools, in the runtime call form', () => {
    const prompt = buildConfigToolsGuidance({ type: 'pi', configuration: {} }, { channelLinked: false, callForm })

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
    const prompt = buildConfigToolsGuidance({ type: 'pi', configuration }, { channelLinked: false, callForm }) ?? ''
    const argsOf = (tool: string) =>
      prompt.match(new RegExp(`<${tool}>[^\`]*\`\\{ ([^}]*) \\}\``))?.[1].split(', ') ?? []

    expect(argsOf(createAgent)).toEqual(
      expect.arrayContaining(['name', 'instructions', 'permissionMode?', 'language?'])
    )
    expect(argsOf(createAssistant)).toEqual(expect.arrayContaining(['name', 'prompt', 'emoji?']))
    expect(argsOf(createAssistant)).not.toContain('instructions')
    expect(argsOf(update)).toEqual(expect.arrayContaining(['permissionMode?', 'language?', 'instructions?']))
  })

  // "创建一个定时任务" is the Agent's own scheduled work, not a request for a new Agent.
  it.each([
    ['a user-created Agent', {}],
    ['Cherry Assistant', { builtin_role: BUILTIN_AGENT_ROLE.ASSISTANT }]
  ])('sends %s to cron for scheduled work instead of the create tools', (_name, configuration) => {
    const prompt = buildConfigToolsGuidance({ type: 'claude-code', configuration }, { channelLinked: false, callForm })

    expect(prompt).toContain('<cherry-tools/cron>')
  })

  // Catches guidance naming a tool the Agent disabled, which the runtime refuses when the model calls it.
  it.each([
    ['config_update', 'cherry-tools/config_update', ['<cherry-tools/agent_create>', '<cherry-tools/assistant_create>']],
    ['agent_create', 'cherry-tools/agent_create', ['<cherry-tools/assistant_create>', '<cherry-tools/config_update>']],
    ['cron', 'cherry-tools/cron', ['<cherry-tools/agent_create>']]
  ])('leaves out a disabled %s and keeps the tools still available', (_tool, disabled, kept) => {
    const prompt =
      buildConfigToolsGuidance(
        { type: 'pi-durable', configuration: {} },
        { channelLinked: false, callForm, isToolEnabled: (server, name) => `${server}/${name}` !== disabled }
      ) ?? ''

    expect(prompt).not.toContain(`<${disabled}>`)
    for (const tool of kept) expect(prompt).toContain(tool)
  })

  it('gives no guidance when every create and settings tool is disabled', () => {
    expect(
      buildConfigToolsGuidance(
        { type: 'pi-durable', configuration: {} },
        { channelLinked: false, callForm, isToolEnabled: (server) => server !== 'cherry-tools' }
      )
    ).toBeUndefined()
  })

  // Catches cron attached to every non-create request, which can persist a job for work meant to run now.
  it('asks for cron only for a scheduled or recurring request', () => {
    const prompt = buildConfigToolsGuidance({ type: 'pi', configuration: {} }, { channelLinked: false, callForm }) ?? ''
    const sentences = prompt.split(/(?<=\.)\s+/)

    expect(sentences.find((sentence) => sentence.includes('<cherry-tools/cron>'))).toMatch(
      /^When the user asks for a scheduled or recurring task/
    )
    expect(sentences.find((sentence) => sentence.includes('Any other request'))).not.toContain('cron')
  })

  it('points Cherry Assistant at its host create and update tools', () => {
    const prompt = buildConfigToolsGuidance(
      { type: 'claude-code', configuration: { builtin_role: BUILTIN_AGENT_ROLE.ASSISTANT } },
      { channelLinked: false, callForm }
    )

    expect(prompt).toContain('<assistant/create_agent>')
    expect(prompt).toContain('<assistant/create_assistant>')
    expect(prompt).toContain('<assistant/update_agent>')
    expect(prompt).not.toContain('config_update')
  })

  // A channel-linked Cherry Assistant session leaves the assistant server unmounted.
  it('names no tools a channel-linked Cherry Assistant session does not mount', () => {
    expect(
      buildConfigToolsGuidance(
        { type: 'claude-code', configuration: { builtin_role: BUILTIN_AGENT_ROLE.ASSISTANT } },
        { channelLinked: true, callForm }
      )
    ).toBeUndefined()
  })

  it.each([BUILTIN_AGENT_ROLE.SUPPORT, BUILTIN_AGENT_ROLE.DOCTOR])(
    'adds no create guidance for the built-in %s Agent, which mounts no create tools',
    (role) => {
      expect(
        buildConfigToolsGuidance(
          { type: 'claude-code', configuration: { builtin_role: role } },
          { channelLinked: false, callForm }
        )
      ).toBeUndefined()
    }
  )
})

describe('buildReportArtifactsGuidance', () => {
  // Pi Durable reaches report_artifacts only from codemode; a Claude Code name left its Outputs empty.
  it('names report_artifacts in the runtime call form, with its hint', () => {
    const prompt = buildReportArtifactsGuidance(callForm)

    expect(prompt).toContain('<cherry-tools/report_artifacts>')
    expect(prompt).toContain('RUNTIME_HINT.')
  })
})
