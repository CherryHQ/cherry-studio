import { expect, it } from 'vitest'

import { withCherryMeta } from '@shared/data/types/uiParts'

import { readFollowupText, replaceFollowupText } from '../agentSessionFollowups'

const url = 'https://example.com/docs'
const original = withCherryMeta(
  { type: 'text' as const, text: `Read ${url} please` },
  {
    composer: {
      version: 1,
      tokens: [{ id: 'link', kind: 'link', label: 'Documentation', index: 0, textOffset: 5, promptText: url }]
    }
  }
)

it.each(['Now 😀 please', 'Summarize the doc'])('keeps %s intact when editing a follow-up with a link', (text) => {
  const edited = replaceFollowupText(original, text)
  expect(edited.text).toBe(`${text}\n${url}`)
  expect(readFollowupText([edited])).toBe(text)

  const again = replaceFollowupText(edited, 'Read this next\n')
  expect(again.text).toBe(`Read this next\n\n${url}`)
  expect(readFollowupText([again])).toBe('Read this next\n')
})
