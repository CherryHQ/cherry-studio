import { describe, expect, it, vi } from 'vitest'

import { VoiceTargetManager } from '../VoiceTargetManager'

function owner(closed = false): Window {
  return { closed } as Window
}

describe('VoiceTargetManager exact binding', () => {
  it('inserts a completion into the original target at its live selection', () => {
    const manager = new VoiceTargetManager()
    const targetOwner = owner()
    let liveRange = { from: 3, to: 8 }
    const replaceRange = vi.fn(() => true)
    manager.bind({
      targetId: 'composer',
      owner: targetOwner,
      sourceEntityId: 'topic-a',
      captureReplaceRange: () => liveRange,
      replaceRange
    })
    manager.markCurrent('composer')
    const binding = manager.captureCurrent()
    liveRange = { from: 20, to: 20 }

    expect(manager.insert(binding!, 'hello')).toBe('inserted')
    expect(replaceRange).toHaveBeenCalledWith({ from: 20, to: 20 }, 'hello')
  })

  it('rejects a captured completion after the same target is rebound to another entity', () => {
    const manager = new VoiceTargetManager()
    const firstInsert = vi.fn(() => true)
    const secondInsert = vi.fn(() => true)
    manager.bind({
      targetId: 'composer',
      owner: owner(),
      sourceEntityId: 'topic-a',
      captureReplaceRange: () => ({ from: 1, to: 1 }),
      replaceRange: firstInsert
    })
    manager.markCurrent('composer')
    const stale = manager.captureCurrent()
    manager.bind({
      targetId: 'composer',
      owner: owner(),
      sourceEntityId: 'topic-b',
      captureReplaceRange: () => ({ from: 5, to: 5 }),
      replaceRange: secondInsert
    })

    expect(manager.insert(stale!, 'late transcript')).toBe('unavailable')
    expect(firstInsert).not.toHaveBeenCalled()
    expect(secondInsert).not.toHaveBeenCalled()
  })

  it('rejects completion after unmount and keeps a replacement safe from stale cleanup', () => {
    const manager = new VoiceTargetManager()
    const firstCleanup = manager.bind({
      targetId: 'composer',
      owner: owner(),
      sourceEntityId: 'topic-a',
      captureReplaceRange: () => ({ from: 0, to: 0 }),
      replaceRange: () => true
    })
    manager.markCurrent('composer')
    const stale = manager.captureCurrent()
    const secondCleanup = manager.bind({
      targetId: 'composer',
      owner: owner(),
      sourceEntityId: 'topic-b',
      captureReplaceRange: () => ({ from: 0, to: 0 }),
      replaceRange: () => true
    })

    firstCleanup()
    expect(manager.markCurrent('composer')).toBe(true)
    secondCleanup()
    expect(manager.insert(stale!, 'late transcript')).toBe('unavailable')
    expect(manager.markCurrent('composer')).toBe(false)
    expect('unbind' in manager).toBe(false)
  })

  it('rejects a completion when its owner window is closed', () => {
    const manager = new VoiceTargetManager()
    const targetOwner = owner()
    const replaceRange = vi.fn(() => true)
    manager.bind({
      targetId: 'composer',
      owner: targetOwner,
      sourceEntityId: 'topic-a',
      captureReplaceRange: () => ({ from: 2, to: 2 }),
      replaceRange
    })
    manager.markCurrent('composer')
    const binding = manager.captureCurrent()
    Object.defineProperty(targetOwner, 'closed', { value: true })

    expect(manager.insert(binding!, 'late transcript')).toBe('unavailable')
    expect(replaceRange).not.toHaveBeenCalled()
  })

  it('uses a live range only for explicit user recovery on a marked current target', () => {
    const manager = new VoiceTargetManager()
    let range = { from: 1, to: 2 }
    const replaceRange = vi.fn(() => true)
    manager.bind({
      targetId: 'composer',
      owner: owner(),
      sourceEntityId: 'topic-a',
      captureReplaceRange: () => range,
      replaceRange
    })

    expect(manager.insertIntoCurrent('ignored', 'user_recovery')).toBe('unavailable')
    expect(replaceRange).not.toHaveBeenCalled()

    manager.markCurrent('composer')
    range = { from: 9, to: 11 }
    expect(manager.insertIntoCurrent('now', 'user_recovery')).toBe('inserted')
    expect(replaceRange).toHaveBeenCalledWith({ from: 9, to: 11 }, 'now')
  })

  it('treats an invalid or rejected range as unavailable', () => {
    const manager = new VoiceTargetManager()
    const replaceRange = vi.fn(() => false)
    manager.bind({
      targetId: 'composer',
      owner: owner(),
      sourceEntityId: 'topic-a',
      captureReplaceRange: () => ({ from: 4, to: 2 }),
      replaceRange
    })
    manager.markCurrent('composer')

    expect(manager.captureCurrent()).toBeNull()
    expect(manager.insertIntoCurrent('text', 'user_recovery')).toBe('unavailable')
    expect(replaceRange).not.toHaveBeenCalled()
  })
})
