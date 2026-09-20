import { describe, expect, it, vi } from 'vitest'

import {
  collectMcpPromptArgs,
  mcpPromptNeedsArgumentForm,
  mcpPromptRequiredArgsFilled
} from '../mcpPromptArgumentDialog'
import { flattenMcpPromptMessages, restoreMcpPromptConsumedQuery } from '../mcpPromptTool'

describe('collectMcpPromptArgs', () => {
  it('omits empty optionals so the server can apply its own default', () => {
    expect(
      collectMcpPromptArgs(
        { arguments: [{ name: 'language', required: true }, { name: 'style' }] },
        { language: ' Go ', style: '  ' }
      )
    ).toEqual({ language: ' Go ' })
  })

  it('sends filled optionals and returns undefined when nothing was provided', () => {
    expect(
      collectMcpPromptArgs(
        { arguments: [{ name: 'language', required: true }, { name: 'style' }] },
        {
          language: 'Go',
          style: 'terse'
        }
      )
    ).toEqual({ language: 'Go', style: 'terse' })
    expect(collectMcpPromptArgs({ arguments: [{ name: 'style' }] }, { style: '' })).toBeUndefined()
    expect(collectMcpPromptArgs({ arguments: [] }, {})).toBeUndefined()
  })
})

describe('mcpPromptNeedsArgumentForm', () => {
  it('opens a form for any declared argument, including optionals', () => {
    expect(mcpPromptNeedsArgumentForm({ arguments: [{ name: 'style' }] })).toBe(true)
    expect(mcpPromptNeedsArgumentForm({ arguments: [] })).toBe(false)
    expect(mcpPromptNeedsArgumentForm({})).toBe(false)
  })
})

describe('mcpPromptRequiredArgsFilled', () => {
  it('requires a non-empty value only for required arguments', () => {
    const prompt = { arguments: [{ name: 'language', required: true }, { name: 'style' }] }
    expect(mcpPromptRequiredArgsFilled(prompt, { language: '', style: '' })).toBe(false)
    expect(mcpPromptRequiredArgsFilled(prompt, { language: 'Go', style: '' })).toBe(true)
    expect(mcpPromptRequiredArgsFilled({ arguments: [{ name: 'style' }] }, { style: '' })).toBe(true)
  })
})

describe('flattenMcpPromptMessages', () => {
  it('joins text parts in order and drops parts with no composer form', () => {
    const result = flattenMcpPromptMessages({
      messages: [
        { role: 'user', content: { type: 'text', text: 'Review this' } },
        { role: 'user', content: { type: 'image', data: 'AAAA' } },
        { role: 'assistant', content: { type: 'text', text: 'in detail' } }
      ]
    })

    expect(result).toBe('Review this\n\nin detail')
  })

  it('returns an empty string for a malformed or empty result', () => {
    expect(flattenMcpPromptMessages(undefined)).toBe('')
    expect(flattenMcpPromptMessages({ messages: [] })).toBe('')
    expect(flattenMcpPromptMessages({ messages: [{ content: { type: 'image' } }] })).toBe('')
  })
})

describe('restoreMcpPromptConsumedQuery', () => {
  it.each(['/', '@'])('restores only the %s trigger when the argument dialog is cancelled', (trigger) => {
    const insertText = vi.fn()
    const focus = vi.fn()
    const parentPanel = {
      list: [],
      symbol: '/',
      triggerInfo: { type: 'input' as const, originalText: trigger },
      initialSearchText: 'review'
    }

    expect(
      restoreMcpPromptConsumedQuery({
        context: { parentPanel } as never,
        action: 'click',
        item: {} as never,
        searchText: 'foo',
        inputAdapter: {
          getText: vi.fn(),
          insertText,
          deleteTriggerRange: vi.fn(),
          focus
        }
      })
    ).toBe(true)

    expect(insertText).toHaveBeenCalledWith(trigger, { tokenizeVariables: false })
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('does not restore button-trigger picks because no composer query was consumed', () => {
    const insertText = vi.fn()

    expect(
      restoreMcpPromptConsumedQuery({
        context: { triggerInfo: { type: 'button' } } as never,
        action: 'click',
        item: {} as never,
        searchText: 'review',
        inputAdapter: {
          getText: vi.fn(),
          insertText,
          deleteTriggerRange: vi.fn(),
          focus: vi.fn()
        }
      })
    ).toBe(false)

    expect(insertText).not.toHaveBeenCalled()
  })

  it('restores only the trigger for searchable input-triggered MCP panels, never panel search text', () => {
    const insertText = vi.fn()
    const focus = vi.fn()

    expect(
      restoreMcpPromptConsumedQuery({
        context: {
          triggerInfo: { type: 'input', originalText: '/' },
          searchInput: { placeholder: 'Search prompts', ariaLabel: 'Search prompts' },
          initialSearchText: 'panel-query',
          parentPanel: {
            list: [],
            symbol: '/',
            triggerInfo: { type: 'input', originalText: '/' },
            initialSearchText: 'review'
          }
        } as never,
        action: 'click',
        item: {} as never,
        searchText: 'panel-query',
        inputAdapter: {
          getText: vi.fn(),
          insertText,
          deleteTriggerRange: vi.fn(),
          focus
        }
      })
    ).toBe(true)

    expect(insertText).toHaveBeenCalledWith('/', { tokenizeVariables: false })
    expect(insertText).not.toHaveBeenCalledWith(expect.stringContaining('panel-query'), expect.anything())
    expect(insertText).not.toHaveBeenCalledWith(expect.stringContaining('review'), expect.anything())
    expect(focus).toHaveBeenCalledTimes(1)
  })

  it('does not restore a query when no input-triggered ancestor exists', () => {
    const insertText = vi.fn()

    expect(
      restoreMcpPromptConsumedQuery({
        context: { searchInput: { placeholder: 'Search prompts', ariaLabel: 'Search prompts' } } as never,
        action: 'click',
        item: {} as never,
        searchText: 'foo',
        inputAdapter: {
          getText: vi.fn(),
          insertText,
          deleteTriggerRange: vi.fn(),
          focus: vi.fn()
        }
      })
    ).toBe(false)

    expect(insertText).not.toHaveBeenCalled()
  })
})
