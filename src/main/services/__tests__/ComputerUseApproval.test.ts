import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'

import { ComputerUseApproval, type ComputerUseAuthorization } from '../ComputerUseApproval'

const app = { id: 'pid:1', name: 'Editor', identity: 'com.example.editor' }
const signal = () => new AbortController().signal
const context = (sessionId = 'session', bypass = false): ComputerUseAuthorization => ({
  current: () => ({ sessionId, topicId: `agent-session:${sessionId}`, bypass, windowId: 'window' }),
  waiting: () => {}
})
let approvals: ComputerUseApproval
beforeEach(() => {
  MockMainPreferenceServiceUtils.resetMocks()
  approvals = new ComputerUseApproval(() => {})
})
afterEach(() => toolApprovalRegistry.clear())

function answer(scope: 'always' | 'session' | 'reject') {
  const [pending] = approvals.list('window')
  expect(pending.app).toEqual(app)
  expect(approvals.respond(pending.approvalId, scope, 'wrong-window')).toBe(false)
  expect(approvals.respond(pending.approvalId, scope, 'window')).toBe(true)
}

describe('application consent', () => {
  it('rejects only this request and never saves a grant', async () => {
    const first = approvals.authorize('owner', app, context(), signal())
    answer('reject')
    await expect(first).rejects.toThrow('rejected')
    const second = approvals.authorize('owner', app, context(), signal())
    answer('session')
    await second
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('app.computer_use.approved_apps')).toEqual([])
  })

  it('shares a pending request and limits session consent to the original owner', async () => {
    const first = approvals.authorize('owner', app, context(), signal())
    const duplicate = approvals.authorize('owner', app, context(), signal())
    expect(approvals.list('window')).toHaveLength(1)
    answer('session')
    await Promise.all([first, duplicate])
    await approvals.authorize('owner', app, context(), signal())
    const child = approvals.authorize('child', app, context('child'), signal())
    answer('reject')
    await expect(child).rejects.toThrow('rejected')
    approvals.clear('owner')
    const reopened = approvals.authorize('owner', app, context(), signal())
    answer('reject')
    await expect(reopened).rejects.toThrow('rejected')
  })

  it('retains Always across service recreation and checks revocation on every access', async () => {
    const first = approvals.authorize('owner', app, context(), signal())
    answer('always')
    await first
    approvals = new ComputerUseApproval(() => {})
    await approvals.authorize('other', { ...app, id: 'pid:2' }, context('other'), signal())
    MockMainPreferenceServiceUtils.setPreferenceValue('app.computer_use.approved_apps', [])
    const next = approvals.authorize('other', app, context('other'), signal())
    answer('reject')
    await expect(next).rejects.toThrow('rejected')
  })

  it('does not transfer a saved grant to another app with the same display name', async () => {
    const first = approvals.authorize('owner', app, context(), signal())
    answer('always')
    await first
    const different = { ...app, id: 'pid:2', identity: 'com.other.editor' }
    const next = approvals.authorize('owner', different, context(), signal())
    const rejected = expect(next).rejects.toThrow('rejected')
    const [pending] = approvals.list('window')
    expect(pending.app.identity).toBe(different.identity)
    approvals.respond(pending.approvalId, 'reject', 'window')
    await rejected
    await approvals.revoke(app.identity)
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('app.computer_use.approved_apps')).toEqual([])
  })

  it('bypasses without remembering consent, then asks when bypass is removed', async () => {
    await approvals.authorize('owner', app, context('session', true), signal())
    expect(approvals.list('window')).toEqual([])
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('app.computer_use.approved_apps')).toEqual([])
    const next = approvals.authorize('owner', app, context(), signal())
    answer('reject')
    await expect(next).rejects.toThrow('rejected')
  })

  it('rejects missing identities and unavailable interaction hosts without pending prompts', async () => {
    await expect(approvals.authorize('owner', { ...app, identity: undefined }, context(), signal())).rejects.toThrow(
      'stable'
    )
    await expect(approvals.authorize('owner', app, undefined, signal())).rejects.toThrow('context')
    await expect(
      approvals.authorize(
        'owner',
        app,
        {
          ...context(),
          current: () => ({ sessionId: 'session', topicId: 'topic', bypass: false })
        },
        signal()
      )
    ).rejects.toThrow('interactive')
    expect(approvals.list('window')).toEqual([])
  })

  it('does not let late or duplicate decisions grant access after cancellation', async () => {
    const abort = new AbortController()
    const pending = approvals.authorize('owner', app, context(), abort.signal)
    const [{ approvalId }] = approvals.list('window')
    abort.abort()
    expect(approvals.respond(approvalId, 'always', 'window')).toBe(false)
    await expect(pending).rejects.toThrow()
    expect(approvals.list('window')).toEqual([])
    expect(MockMainPreferenceServiceUtils.getPreferenceValue('app.computer_use.approved_apps')).toEqual([])
  })
})
