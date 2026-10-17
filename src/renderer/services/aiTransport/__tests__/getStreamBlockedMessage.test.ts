import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import i18n from '@renderer/i18n/resolver'

import { getStreamBlockedMessage } from '../getStreamBlockedMessage'

let previousLanguage: string

beforeEach(async () => {
  previousLanguage = i18n.language
  await i18n.changeLanguage('zh-CN')
})

afterEach(async () => {
  await i18n.changeLanguage(previousLanguage)
})

describe('getStreamBlockedMessage', () => {
  it('distinguishes a backup pause from a restore pause using the real catalogue', () => {
    const backup = getStreamBlockedMessage({ mode: 'blocked', reason: 'paused', operation: 'backup' })
    const restore = getStreamBlockedMessage({ mode: 'blocked', reason: 'paused', operation: 'restore' })

    expect(backup).toBe('正在备份；完成前已暂停发送新消息。')
    expect(restore).toBe('正在恢复备份；完成前已暂停发送新消息。')
  })

  it('preserves the workspace failure message', () => {
    expect(
      getStreamBlockedMessage({
        mode: 'blocked',
        reason: 'agent-session-workspace',
        message: 'Workspace path is not accessible: /missing'
      })
    ).toBe('Workspace path is not accessible: /missing')
  })
})
