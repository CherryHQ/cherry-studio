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

  // "创建一个定时任务" is the Agent's own scheduled work, not a request for a new Agent.
  it.each([
    ['a user-created Agent', {}],
    ['Cherry Assistant', { builtin_role: BUILTIN_AGENT_ROLE.ASSISTANT }]
  ])('sends %s to cron for scheduled work instead of the create tools', (_name, configuration) => {
    const prompt = buildConfigToolsGuidance({ type: 'claude-code', configuration }, { channelLinked: false, callForm })

    expect(prompt).toContain('<cherry-tools/cron>')
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
