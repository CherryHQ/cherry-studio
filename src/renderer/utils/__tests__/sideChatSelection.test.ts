import type { Root } from 'hast'
import { afterEach, describe, expect, it } from 'vitest'

import { rehypeSideChatSource } from '@renderer/components/chat/messages/markdown/plugins/rehypeSideChatSource'

import { readSideChatSelection } from '../sideChatSelection'

afterEach(() => {
  document.body.replaceChildren()
  window.getSelection()?.removeAllRanges()
})
describe('side-chat source selection', () => {
  it('accepts only text with a matching original source position', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'text',
          value: 'bold',
          position: { start: { line: 1, column: 3, offset: 2 }, end: { line: 1, column: 7, offset: 6 } }
        }
      ]
    }
    rehypeSideChatSource({ source: '**bold**' })(tree)
    expect(tree.children[0]).toMatchObject({ type: 'element', properties: { 'data-side-chat-source': 'bold' } })
    const transformed: Root = { type: 'root', children: [{ type: 'text', value: 'changed' }] }
    rehypeSideChatSource({ source: 'original' })(transformed)
    expect(transformed.children[0].type).toBe('text')
  })
  it('maps within an attested text node and rejects cross-span or modified text', () => {
    document.body.innerHTML =
      '<div data-side-chat-message="answer"><span data-side-chat-source="hello">hello</span><b>world</b></div>'
    const span = document.querySelector('span')!
    const range = document.createRange()
    range.setStart(span.firstChild!, 1)
    range.setEnd(span.firstChild!, 4)
    const selection = window.getSelection()!
    selection.addRange(range)
    expect(readSideChatSelection(selection)).toEqual({ messageId: 'answer', selection: 'ell' })
    range.setEnd(document.querySelector('b')!.firstChild!, 3)
    expect(readSideChatSelection(selection)).toBeNull()
    range.setEnd(span.firstChild!, 4)
    span.dataset.sideChatSource = 'different'
    expect(readSideChatSelection(selection)).toBeNull()
  })
  it('rejects selections across answers or outside assistant answers', () => {
    document.body.innerHTML = '<div data-side-chat-message="a">one</div><div data-side-chat-message="b">two</div>'
    const range = document.createRange()
    range.setStart(document.body.children[0].firstChild!, 0)
    range.setEnd(document.body.children[1].firstChild!, 2)
    const selection = window.getSelection()!
    selection.addRange(range)
    expect(readSideChatSelection(selection)).toBeNull()
  })
})
