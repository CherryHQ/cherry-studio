import { findCommandDefinition } from '@shared/utils/command'
import { describe, expect, it } from 'vitest'

import { getCommandShortcutLabel, getShortcutBindingFromKeyboardEvent, resolveCommandDisplayState } from '../command'

describe('getShortcutBindingFromKeyboardEvent', () => {
  it('normalizes command/control shortcuts by platform', () => {
    expect(getShortcutBindingFromKeyboardEvent({ key: 'n', code: 'KeyN', metaKey: true }, 'darwin')).toEqual([
      'CommandOrControl',
      'N'
    ])
    expect(getShortcutBindingFromKeyboardEvent({ key: 'n', code: 'KeyN', ctrlKey: true }, 'win32')).toEqual([
      'CommandOrControl',
      'N'
    ])
  })

  it('normalizes named, numpad, and symbol keys', () => {
    expect(getShortcutBindingFromKeyboardEvent({ key: 'Escape', code: 'Escape' }, 'darwin')).toEqual(['Escape'])
    expect(getShortcutBindingFromKeyboardEvent({ key: '+', code: 'NumpadAdd', ctrlKey: true }, 'win32')).toEqual([
      'CommandOrControl',
      'numadd'
    ])
    expect(getShortcutBindingFromKeyboardEvent({ key: '+', code: 'Equal', ctrlKey: true }, 'win32')).toEqual([
      'CommandOrControl',
      '='
    ])
  })
})

describe('getCommandShortcutLabel', () => {
  it('formats primary binding for each platform family', () => {
    expect(getCommandShortcutLabel('topic.create', undefined, { context: {}, isMac: true, platform: 'darwin' })).toBe(
      '⌘N'
    )
    expect(getCommandShortcutLabel('topic.create', undefined, { context: {}, isMac: false, platform: 'win32' })).toBe(
      'Ctrl+N'
    )
  })

  it('returns empty label when unavailable', () => {
    expect(getCommandShortcutLabel('topic.create', { binding: [], enabled: true }, { context: {}, isMac: true })).toBe(
      ''
    )
    expect(
      getCommandShortcutLabel('selection.toggle', undefined, {
        context: { 'feature.selection.enabled': true },
        isMac: false,
        platform: 'linux'
      })
    ).toBe('')
  })
})

describe('resolveCommandDisplayState', () => {
  it('translates the title and resolves the shortcut label', () => {
    const definition = findCommandDefinition('topic.create')
    const state = resolveCommandDisplayState('topic.create', {
      definition,
      preference: undefined,
      context: {},
      hasHandler: () => true,
      translate: (key) => `t:${key}`,
      isMac: true,
      platform: 'darwin'
    })

    expect(state.label).toBe(`t:${definition?.titleKey}`)
    expect(state.shortcutLabel).toBe('⌘N')
  })

  it('falls back to the command id and stays disabled without a definition', () => {
    const state = resolveCommandDisplayState('topic.create', {
      definition: undefined,
      preference: undefined,
      context: {},
      hasHandler: () => true,
      translate: (key) => key,
      isMac: true,
      platform: 'darwin'
    })

    expect(state.label).toBe('topic.create')
    expect(state.enabled).toBe(false)
    expect(state.shortcutLabel).toBe('⌘N')
  })
})
