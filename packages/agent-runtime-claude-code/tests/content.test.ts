import { expect, it } from 'vitest'

import { decodeArchiveContent } from '../src/content'

it('extracts only valid text from a failed archived tool result without discarding its raw output', () => {
  const output = [
    { type: 'text', text: { toString: null } },
    { type: 'text' },
    { type: 'text', text: 'Permission denied' },
    { type: 'image', text: 'Not a text block' },
    { type: 'text', text: 'Request access from the owner' }
  ]

  expect(
    decodeArchiveContent(
      { content: [{ type: 'tool_result', tool_use_id: 'tool-1', is_error: true, content: output }] },
      false
    )
  ).toEqual({
    id: undefined,
    blocks: [
      {
        result: {
          toolUseId: 'tool-1',
          output,
          errorText: 'Permission denied\nRequest access from the owner'
        }
      }
    ]
  })
})
