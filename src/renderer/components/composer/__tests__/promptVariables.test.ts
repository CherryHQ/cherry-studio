import { describe, expect, it } from 'vitest'

import {
  createPromptVariableContent,
  createPromptVariableInlineContent,
  parsePromptVariableSegments
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

  it('uses concrete localized example values as editable token labels', () => {
    expect(
      parsePromptVariableSegments('Names: ${Lin Zhao & Shen Zhiyi}; venue: ${杭州 · 白塔公园}; age: ${2}')
    ).toEqual([
      { type: 'text', text: 'Names: ' },
      {
        type: 'variable',
        index: 0,
        raw: '${Lin Zhao & Shen Zhiyi}',
        variableName: 'Lin Zhao & Shen Zhiyi'
      },
      { type: 'text', text: '; venue: ' },
      {
        type: 'variable',
        index: 1,
        raw: '${杭州 · 白塔公园}',
        variableName: '杭州 · 白塔公园'
      },
      { type: 'text', text: '; age: ' },
      { type: 'variable', index: 2, raw: '${2}', variableName: '2' }
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
})
