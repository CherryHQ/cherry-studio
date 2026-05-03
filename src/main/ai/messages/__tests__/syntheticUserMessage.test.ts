import { describe, expect, it } from 'vitest'

import {
  buildAsyncTaskErrorMessage,
  buildAsyncTaskResultMessage,
  buildSyntheticUserMessage,
  wrapInXmlTag
} from '../syntheticUserMessage'

describe('wrapInXmlTag', () => {
  it('wraps content with attributes', () => {
    expect(wrapInXmlTag('async-task-result', { task: 'agent-abc' }, 'hello')).toBe(
      '<async-task-result task="agent-abc">\nhello\n</async-task-result>'
    )
  })

  it('wraps content without attributes', () => {
    expect(wrapInXmlTag('system-reminder', undefined, 'do thing')).toBe(
      '<system-reminder>\ndo thing\n</system-reminder>'
    )
  })

  it('is idempotent — does not double-wrap content already opened by same tag', () => {
    const already = '<system-reminder>\ndo thing\n</system-reminder>'
    expect(wrapInXmlTag('system-reminder', undefined, already)).toBe(already)
  })

  it('idempotent across attribute presence', () => {
    const already = '<async-task-result task="agent-abc">\nhello\n</async-task-result>'
    expect(wrapInXmlTag('async-task-result', { task: 'agent-other' }, already)).toBe(already)
  })
})

describe('buildSyntheticUserMessage', () => {
  it('produces a user-role Message with the given text and topic', () => {
    const msg = buildSyntheticUserMessage('topic-A', 'plain text')
    expect(msg.role).toBe('user')
    expect(msg.topicId).toBe('topic-A')
    expect(msg.data.parts).toEqual([{ type: 'text', text: 'plain text' }])
    expect(msg.parentId).toBeNull()
    expect(msg.status).toBe('success')
    expect(typeof msg.id).toBe('string')
  })
})

describe('buildAsyncTaskResultMessage / buildAsyncTaskErrorMessage', () => {
  it('result variant wraps text in <async-task-result>', () => {
    const msg = buildAsyncTaskResultMessage('topic-A', 'agent-abc', 'final result')
    const text = (msg.data.parts![0] as { type: 'text'; text: string }).text
    expect(text).toBe('<async-task-result task="agent-abc">\nfinal result\n</async-task-result>')
    expect(msg.role).toBe('user')
    expect(msg.topicId).toBe('topic-A')
  })

  it('error variant wraps text in <async-task-error>', () => {
    const msg = buildAsyncTaskErrorMessage('topic-X', 'agent-xyz', 'boom')
    const text = (msg.data.parts![0] as { type: 'text'; text: string }).text
    expect(text).toBe('<async-task-error task="agent-xyz">\nboom\n</async-task-error>')
  })
})
