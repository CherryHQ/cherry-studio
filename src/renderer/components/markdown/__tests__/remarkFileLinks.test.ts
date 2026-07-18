import type { Link, Root } from 'mdast'
import { describe, expect, it } from 'vitest'

import { remarkFileLinks } from '../remarkFileLinks'

/** Build a one-paragraph mdast tree holding a single link with the given url. */
function treeWithLink(url: string): Root {
  return {
    type: 'root',
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'link', url, children: [{ type: 'text', value: 'x' }] }]
      }
    ]
  }
}

function transformedUrl(url: string): string {
  const tree = treeWithLink(url)
  remarkFileLinks()(tree)
  const paragraph = tree.children[0] as { children: Link[] }
  return paragraph.children[0].url
}

describe('remarkFileLinks', () => {
  it.each([
    ['C:/Users/Alice/README.md', '/C:/Users/Alice/README.md'],
    ['C:\\Users\\Alice\\README.md', '/C:/Users/Alice/README.md'],
    ['d:/lower/drive.md', '/d:/lower/drive.md']
  ])('roots the drive path %s → %s', (url, expected) => {
    expect(transformedUrl(url)).toBe(expected)
  })

  it.each(['/home/user/x.md', './relative.md', '../up.md', 'docs/guide.md', 'https://example.com/x', 'C:notadrive'])(
    'leaves %s untouched',
    (url) => {
      expect(transformedUrl(url)).toBe(url)
    }
  )
})
