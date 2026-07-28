import { describe, expect, it, vi } from 'vitest'

import {
  createPromptVariableContent,
  createPromptVariableInlineContent,
  parsePromptVariableSegments,
  selectPromptVariableToken
} from '../promptVariables'

describe('prompt variable composer helpers', () => {
  it('parses prompt variables into text and variable segments', () => {
    expect(parsePromptVariableSegments('Help ${from} to ${to}')).toEqual([
      { type: 'text', text: 'Help ' },
      { type: 'variable', index: 0, raw: '${from}', variableName: 'from' },
      { type: 'text', text: ' to ' },
      { type: 'variable', index: 1, raw: '${to}', variableName: 'to' }
    ])
  })

  it('leaves empty, multiline, and system-style variables as plain text', () => {
    expect(parsePromptVariableSegments('A ${} B ${from\n} C {{date}}')).toEqual([
      { type: 'text', text: 'A ${} B ${from\n} C {{date}}' }
    ])
  })

  it('creates stable prompt-variable token nodes with unique ids', () => {
    expect(createPromptVariableContent('Use ${city} and ${city}')).toEqual({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Use ' },
            {
              type: 'composerToken',
              attrs: {
                id: 'prompt-variable:0:city',
                kind: 'promptVariable',
                label: 'city',
                description: '${city}',
                promptText: '${city}',
                payload: { raw: '${city}', variableName: 'city' }
              }
            },
            { type: 'text', text: ' and ' },
            {
              type: 'composerToken',
              attrs: {
                id: 'prompt-variable:1:city',
                kind: 'promptVariable',
                label: 'city',
                description: '${city}',
                promptText: '${city}',
                payload: { raw: '${city}', variableName: 'city' }
              }
            }
          ]
        }
      ]
    })
  })

  it('offsets inline prompt variable ids when inserting into an existing editor document', () => {
    expect(createPromptVariableInlineContent('${city}', { startIndex: 2 })).toEqual([
      {
        type: 'composerToken',
        attrs: {
          id: 'prompt-variable:2:city',
          kind: 'promptVariable',
          label: 'city',
          description: '${city}',
          promptText: '${city}',
          payload: { raw: '${city}', variableName: 'city' }
        }
      }
    ])
  })

  it('focuses before selecting a prompt variable token for Tab navigation', () => {
    const calls: string[] = []
    const run = vi.fn(() => true)
    const editor = {
      state: {
        selection: { from: 1 },
        doc: {
          descendants: (visit: (node: unknown, position: number) => void) => {
            visit(
              {
                type: { name: 'composerToken' },
                attrs: {
                  id: 'prompt-variable:0:city',
                  kind: 'promptVariable',
                  label: 'city',
                  promptText: '${city}'
                }
              },
              5
            )
          }
        }
      },
      chain: () => ({
        focus: () => {
          calls.push('focus')
          return {
            setNodeSelection: (position: number) => {
              calls.push(`setNodeSelection:${position}`)
              return { run }
            }
          }
        }
      })
    }

    const token = selectPromptVariableToken(editor as never, 1)

    expect(token?.id).toBe('prompt-variable:0:city')
    expect(calls).toEqual(['focus', 'setNodeSelection:5'])
    expect(run).toHaveBeenCalled()
  })
})
