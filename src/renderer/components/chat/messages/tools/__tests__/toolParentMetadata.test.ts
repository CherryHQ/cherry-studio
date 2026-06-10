import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it } from 'vitest'

import { getPartParentToolCallId, hasPartParentToolCallId, stripPartParentToolMetadata } from '../toolParentMetadata'

const part = (value: Record<string, unknown>) => value as unknown as CherryMessagePart

describe('toolParentMetadata', () => {
  it('reads direct parent tool ids first', () => {
    const value = part({
      parentToolUseId: 'direct-parent',
      callProviderMetadata: {
        'claude-code': {
          parentToolCallId: 'metadata-parent'
        }
      }
    })

    expect(getPartParentToolCallId(value)).toBe('direct-parent')
    expect(hasPartParentToolCallId(value)).toBe(true)
  })

  it('reads Claude Code parent ids from supported metadata fields', () => {
    expect(
      getPartParentToolCallId(
        part({
          providerMetadata: {
            'claude-code': {
              parentToolUseId: 'provider-parent'
            }
          }
        })
      )
    ).toBe('provider-parent')

    expect(
      getPartParentToolCallId(
        part({
          resultProviderMetadata: {
            'claude-code': {
              parentToolCallId: 'result-parent'
            }
          }
        })
      )
    ).toBe('result-parent')
  })

  it('returns undefined when no parent id is present', () => {
    const value = part({ callProviderMetadata: { other: { parentToolCallId: 'ignored' } } })

    expect(getPartParentToolCallId(value)).toBeUndefined()
    expect(hasPartParentToolCallId(value)).toBe(false)
  })

  it('strips direct and nested parent metadata without mutating the original part', () => {
    const value = part({
      parentToolUseId: 'direct-parent',
      callProviderMetadata: {
        'claude-code': {
          parentToolCallId: 'metadata-parent',
          keep: true
        },
        other: true
      },
      resultProviderMetadata: {
        'claude-code': {
          parentToolUseId: 'result-parent',
          keepResult: true
        }
      }
    })

    const stripped = stripPartParentToolMetadata(value) as unknown as Record<string, any>

    expect(stripped).not.toBe(value)
    expect(stripped.parentToolUseId).toBeUndefined()
    expect(stripped.callProviderMetadata['claude-code']).toEqual({ keep: true })
    expect(stripped.callProviderMetadata.other).toBe(true)
    expect(stripped.resultProviderMetadata['claude-code']).toEqual({ keepResult: true })

    const original = value as unknown as Record<string, any>
    expect(original.parentToolUseId).toBe('direct-parent')
    expect(original.callProviderMetadata['claude-code'].parentToolCallId).toBe('metadata-parent')
  })

  it('returns the original part when no parent metadata needs stripping', () => {
    const value = part({ callProviderMetadata: { other: true } })

    expect(stripPartParentToolMetadata(value)).toBe(value)
  })
})
