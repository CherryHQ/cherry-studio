import type { JSONContent } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { StarterKit } from '@tiptap/starter-kit'
import { describe, expect, it } from 'vitest'

import { YamlFrontMatter } from '../yamlFrontMatter'

const parseFrontMatters = (markdown: string) => {
  const manager = new MarkdownManager({
    extensions: [YamlFrontMatter]
  })
  const doc = manager.parse(markdown)
  const frontMatterNodes = (doc.content || []).filter((node) => node.type === 'yamlFrontMatter')
  return frontMatterNodes.map((node) => (node.attrs as { content?: string } | undefined)?.content?.trim())
}

describe('YamlFrontMatter markdown tokenizer', () => {
  it('only parses the first front matter block at the very start of the document', () => {
    const markdown = `---
title: First
---

Body text

---
title: Second
---
More content`

    const contents = parseFrontMatters(markdown)
    expect(contents).toHaveLength(1)
    expect(contents[0]).toBe('title: First')
  })

  it('ignores a front matter block when it is not at the beginning of the document', () => {
    const markdown = `Intro paragraph

---
title: Should not parse
---`

    const contents = parseFrontMatters(markdown)
    expect(contents).toHaveLength(0)
  })

  it('ignores consecutive front matter blocks after the first one', () => {
    const markdown = `---
first: yes
---
---
second: no
---`

    const contents = parseFrontMatters(markdown)
    expect(contents).toHaveLength(1)
    expect(contents[0]).toBe('first: yes')
  })

  it('does not treat body content containing --- as additional front matter', () => {
    const markdown = `---
title: Only header
---

Paragraph text.

---

More text.`

    const contents = parseFrontMatters(markdown)
    expect(contents).toHaveLength(1)
    expect(contents[0]).toBe('title: Only header')
  })
})

describe('YamlFrontMatter markdown round-trip', () => {
  const manager = new MarkdownManager({
    extensions: [StarterKit, YamlFrontMatter]
  })

  const roundTrip = (markdown: string) => manager.serialize(manager.parse(markdown)).trim()

  it('round-trips front matter together with body markdown', () => {
    const markdown = `---
title: Hello
tags: [a, b]
---

# Heading

Body **bold** text.`

    const result = roundTrip(markdown)
    expect(result.startsWith('---\ntitle: Hello\ntags: [a, b]\n---')).toBe(true)
    expect(result).toContain('# Heading')
    expect(result).toContain('**bold**')
  })

  it('drops empty front matter on serialization', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        { type: 'yamlFrontMatter', attrs: { content: '   ' } },
        { type: 'paragraph', content: [{ type: 'text', text: 'hi' }] }
      ]
    }
    const result = manager.serialize(doc).trim()
    expect(result).toBe('hi')
  })
})
