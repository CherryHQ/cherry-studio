import { expect, it } from 'vitest'

import { locateSideChatSource } from '../sideChatAnchor'
const source = {
  messageId: 'a',
  selection: 'quote',
  answer: 'before quote after',
  question: '',
  prefix: 'before ',
  suffix: ' after'
}
it('locates only a unique source with matching surrounding text', () => {
  expect(locateSideChatSource('before quote after', source)).toBe(7)
  expect(locateSideChatSource('before quote after quote', source)).toBeNull()
  expect(locateSideChatSource('changed quote after', source)).toBeNull()
  expect(locateSideChatSource('answer deleted', source)).toBeNull()
  expect(locateSideChatSource('before quote after', { ...source, prefix: '', suffix: '' })).toBeNull()
})
