import { describe, expect, it } from 'vitest'

import {
  buildAntigravityUserInputRequest,
  isAntigravityUserInputRequest,
  mapAcpPermissionOptions,
  resolveAntigravityUserInputOptionId
} from '../antigravityProtocol'

describe('antigravityProtocol', () => {
  it('injects host session approval when allow_always is absent and scopes Antigravity allow_always to session', () => {
    const allowOnceOnly = mapAcpPermissionOptions(
      [
        { optionId: 'allow', name: 'Allow', kind: 'allow_once' },
        { optionId: 'deny', name: 'Deny', kind: 'reject_once' }
      ],
      { isAntigravity: true, hostAllowSessionOptionId: '__host_session__' }
    )
    expect(allowOnceOnly).toEqual([
      { optionId: 'allow', decision: 'accept', label: 'allow', name: 'Allow' },
      { optionId: '__host_session__', decision: 'acceptForSession', label: 'allow_session', name: 'Allow for session' },
      { optionId: 'deny', decision: 'decline', label: 'deny', name: 'Deny' }
    ])

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
      { isAntigravity: true, hostAllowSessionOptionId: '__host_session__' }
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

    const generic = mapAcpPermissionOptions(
      [
        { optionId: 'always', name: 'Always allow', kind: 'allow_always' },
        { optionId: 'session', name: 'Allow for session', kind: 'allow_always' }
      ],
      {
        isAntigravity: false,
        hostAllowSessionOptionId: '__host_session__'
      }
    )
    expect(generic).toEqual([
      { optionId: 'always', decision: 'acceptAlways', label: 'allow_always', name: 'Always allow' },
      { optionId: 'session', decision: 'acceptForSession', label: 'allow_session', name: 'Allow for session' }
    ])
  })

  it('routes interaction_* permission requests as AskUserQuestion and resolves the chosen optionId', () => {
    const request = {
      toolCall: { toolCallId: 'interaction_1', title: 'Choose environment', rawInput: { prompt: 'Which target?' } },
      options: [
        { optionId: 'opt-staging', name: 'Staging', kind: 'allow_once' as const },
        { optionId: 'opt-prod', name: 'Production', kind: 'allow_once' as const }
      ]
    }
    expect(isAntigravityUserInputRequest(request)).toBe(true)
    expect(buildAntigravityUserInputRequest(request)).toEqual({
      questions: [
        {
          id: 'interaction_1',
          question: 'Which target?',
          header: 'Question',
          multiSelect: false,
          options: [{ label: 'Staging' }, { label: 'Production' }]
        }
      ],
      responseMode: 'native-request'
    })
    expect(
      resolveAntigravityUserInputOptionId(request, true, {
        action: 'submit',
        selections: [{ selected: ['Production'] }]
      })
    ).toBe('opt-prod')
    expect(resolveAntigravityUserInputOptionId(request, false, {})).toBeUndefined()
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
      { isAntigravity: true, hostAllowSessionOptionId: '__host_session__' }
    )
    expect(agyMapped[0].warning).toHaveLength(512)
    expect(agyMapped[0].warning?.endsWith('...')).toBe(true)
    expect(agyMapped[1]).toMatchObject({ optionId: 'always-title', warning: 'Title warning' })
    expect(agyMapped[2].warning).toBeUndefined()

    const nonAgy = mapAcpPermissionOptions(
      [
        {
          optionId: 'custom',
          name: 'Allow only /tmp/project',
          kind: 'allow_always',
          _meta: { 'agy.security.warning': { message: 'Ignored outside Antigravity' } }
        },
        { optionId: 'deny-only', name: 'Deny', kind: 'reject_once' }
      ],
      { isAntigravity: false, hostAllowSessionOptionId: '__host_session__' }
    )
    expect(nonAgy[0]).toEqual({
      optionId: 'custom',
      decision: 'acceptAlways',
      label: undefined,
      name: 'Allow only /tmp/project'
    })
    // No allow_once option -> must not synthesize host allow_session
    expect(nonAgy).toHaveLength(2)

    const fallbackQuestion = {
      toolCall: { toolCallId: 'interaction_2', title: 'Fallback prompt' },
      options: [
        { optionId: 'a', name: 'Same', kind: 'allow_once' as const },
        { optionId: 'b', name: 'Same', kind: 'allow_once' as const }
      ]
    }
    expect(isAntigravityUserInputRequest({ toolCall: { toolCallId: 'call_1' }, options: [] })).toBe(false)
    expect(buildAntigravityUserInputRequest(fallbackQuestion).questions).toMatchObject([
      { question: 'Fallback prompt' }
    ])
    // Ambiguous duplicate label must fail closed rather than picking the first option
    expect(
      resolveAntigravityUserInputOptionId(fallbackQuestion, true, {
        action: 'submit',
        selections: [{ selected: ['Same'] }]
      })
    ).toBeUndefined()
  })

  it('assigns structured i18n labels for Yes allow once, Reject once, Cancel, and Never allow ACP options', () => {
    const mapped = mapAcpPermissionOptions(
      [
        { optionId: 'yes-once', name: 'Yes, allow once', kind: 'allow_once' },
        { optionId: 'rej-once', name: 'Reject once', kind: 'reject_once' },
        { optionId: 'rej-cancel', name: 'Cancel', kind: 'reject_once' },
        { optionId: 'rej-always', name: 'No, never allow', kind: 'reject_always' }
      ],
      { isAntigravity: false, hostAllowSessionOptionId: '__host_session__' }
    )

    expect(mapped.map((option) => ({ optionId: option.optionId, label: option.label }))).toEqual([
      { optionId: 'yes-once', label: 'allow_once' },
      { optionId: '__host_session__', label: 'allow_session' },
      { optionId: 'rej-once', label: 'deny' },
      { optionId: 'rej-cancel', label: 'cancel' },
      { optionId: 'rej-always', label: 'deny_always' }
    ])
  })
})
