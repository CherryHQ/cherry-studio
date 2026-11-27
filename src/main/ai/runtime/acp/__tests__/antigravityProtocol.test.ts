import { PassThrough, Readable } from 'node:stream'

import { describe, expect, it } from 'vitest'

import { mapAcpPermissionOptions } from '@cherrystudio/agent-runtime-acp/v1'
import { antigravityPreset, readAntigravitySubscriptionUsage } from '@cherrystudio/agent-runtime-antigravity-acp'
import type { SpawnStdio, StdioProcess } from '@cherrystudio/agent-runtime/stdio'

const { describePermissionOption, permissionQuestion } = antigravityPreset.protocol

describe('antigravityProtocol', () => {
  it('preserves quota groups and periods and omits the native zero-date sentinel', async () => {
    const resetTime = '2026-11-28T09:00:00.000Z'
    const spawn: SpawnStdio = ({ args }) => {
      const result =
        args[0] === '--version'
          ? '1.5.18'
          : args[0] === 'models'
            ? 'Gemini'
            : JSON.stringify({
                status: 'SUCCESS',
                num_turns: 0,
                command: {
                  name: 'usage',
                  data: {
                    groups: [
                      {
                        name: 'Gemini',
                        buckets: [
                          { name: 'Five Hour Limit', window: '5h', remaining_fraction: 0.75, reset_time: resetTime },
                          {
                            name: 'Weekly Limit',
                            window: 'weekly',
                            remaining_fraction: 1,
                            reset_time: '1970-01-01T00:00:00Z'
                          }
                        ]
                      }
                    ]
                  }
                }
              })
      const stdout = Readable.from([Buffer.from(result)])
      const closed: StdioProcess['closed'] = new Promise((resolve) =>
        stdout.once('end', () => resolve({ kind: 'exited', code: 0, signal: null }))
      )
      return { stdout, stdin: new PassThrough(), stderr: new PassThrough().end(), closed, closeAndJoin: async () => {} }
    }
    const quota = await readAntigravitySubscriptionUsage(
      { executable: 'agy', args: [], env: {}, cwd: '/test' },
      spawn,
      new AbortController().signal
    )
    expect(quota).toMatchObject({
      status: 'available',
      windows: [
        {
          groupLabel: 'Gemini',
          label: 'Five Hour Limit',
          durationMinutes: 300,
          usedRatio: 0.25,
          resetsAt: Date.parse(resetTime)
        },
        { groupLabel: 'Gemini', label: 'Weekly Limit', durationMinutes: 10080, usedRatio: 0, resetsAt: undefined }
      ]
    })
  })

  it('keeps Antigravity always approval scoped to the current session', () => {
    const withWarning = mapAcpPermissionOptions(
      [
        { optionId: 'once', name: 'Allow once', kind: 'allow_once' },
        {
          optionId: 'always',
          name: 'Always Allow',
          kind: 'allow_always',
          _meta: { 'agy.security.warning': { message: 'Allows shell commands in this thread.' } }
        }
      ],
      describePermissionOption
    )
    expect(withWarning).toEqual([
      { optionId: 'once', decision: 'accept', label: 'allow_once', name: 'Allow once' },
      {
        optionId: 'always',
        decision: 'acceptForSession',
        label: 'allow_session',
        name: 'Always Allow',
        warning: 'Allows shell commands in this thread.'
      }
    ])

    const generic = mapAcpPermissionOptions([
      { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
      { optionId: 'session', name: 'Allow for session', kind: 'allow_always' }
    ])
    expect(generic).toEqual([
      { optionId: 'always', decision: 'acceptAlways', label: 'allow_always', name: 'Always allow' },
      { optionId: 'session', decision: 'acceptForSession', label: 'allow_session', name: 'Allow for session' }
    ])
  })

  it('routes interaction_* permission requests as AskUserQuestion and resolves the chosen optionId', () => {
    const request = {
      sessionId: 'session',
      toolCall: { toolCallId: 'interaction_1', title: 'Choose environment', rawInput: { prompt: 'Which target?' } },
      options: [
        { optionId: 'opt-staging', name: 'Staging', kind: 'allow_once' as const },
        { optionId: 'opt-prod', name: 'Production', kind: 'allow_once' as const }
      ]
    }
    const question = permissionQuestion(request)
    expect(question).toMatchObject({
      text: 'Which target?',
      options: [{ label: 'Staging' }, { label: 'Production' }]
    })
    expect(question?.optionIdFor('Production')).toBe('opt-prod')
    expect(question?.optionIdFor('opt-prod')).toBe('opt-prod')
    expect(question?.optionIdFor('other')).toBeUndefined()
  })

  it('bounds long warnings, falls back to title, ignores warnings on non-Antigravity, and handles edge cases', () => {
    const longMessage = 'x'.repeat(600)
    const agyMapped = mapAcpPermissionOptions(
      [
        {
          optionId: 'always-long',
          name: 'Always Allow',
          kind: 'allow_always',
          _meta: { 'agy.security.warning': { message: longMessage } }
        },
        {
          optionId: 'always-title',
          name: 'Allow only /tmp/project',
          kind: 'allow_always',
          _meta: { 'agy.security.warning': { title: 'Title warning', message: '   ' } }
        },
        {
          optionId: 'always-blank',
          name: 'Always Allow',
          kind: 'allow_always',
          _meta: { 'agy.security.warning': { title: '  ' } }
        }
      ],
      describePermissionOption
    )
    expect(agyMapped[0].warning).toHaveLength(512)
    expect(agyMapped[0].warning?.endsWith('...')).toBe(true)
    expect(agyMapped[1]).toMatchObject({ optionId: 'always-title', warning: 'Title warning' })
    expect(agyMapped[2].warning).toBeUndefined()

    const nonAgy = mapAcpPermissionOptions([
      {
        optionId: 'custom',
        name: 'Allow only /tmp/project',
        kind: 'allow_always',
        _meta: { 'agy.security.warning': { message: 'Ignored outside Antigravity' } }
      },
      { optionId: 'deny-only', name: 'Deny', kind: 'reject_once' }
    ])
    expect(nonAgy[0]).toEqual({
      optionId: 'custom',
      decision: 'acceptAlways',
      label: undefined,
      name: 'Allow only /tmp/project'
    })
  })

  it('ignores ordinary tool calls and rejects ambiguous question labels', () => {
    const question = permissionQuestion({
      sessionId: 'session',
      toolCall: { toolCallId: 'interaction_2', title: 'Fallback prompt' },
      options: [
        { optionId: 'a', name: 'Same', kind: 'allow_once' },
        { optionId: 'b', name: 'Same', kind: 'allow_once' }
      ]
    })
    expect(
      permissionQuestion({ sessionId: 'session', toolCall: { toolCallId: 'call_1' }, options: [] })
    ).toBeUndefined()
    expect(question?.text).toBe('Fallback prompt')
    expect(question?.optionIdFor('Same')).toBeUndefined()
  })

  it('assigns structured i18n labels for Yes allow once, Reject once, Cancel, and Never allow ACP options', () => {
    const mapped = mapAcpPermissionOptions([
      { optionId: 'yes-once', name: 'Yes, allow once', kind: 'allow_once' },
      { optionId: 'rej-once', name: 'Reject once', kind: 'reject_once' },
      { optionId: 'rej-cancel', name: 'Cancel', kind: 'reject_once' },
      { optionId: 'rej-always', name: 'No, never allow', kind: 'reject_always' }
    ])

    expect(mapped.map((option) => ({ optionId: option.optionId, label: option.label }))).toEqual([
      { optionId: 'yes-once', label: 'allow_once' },
      { optionId: 'rej-once', label: 'deny' },
      { optionId: 'rej-cancel', label: 'cancel' },
      { optionId: 'rej-always', label: 'deny_always' }
    ])
  })
})
