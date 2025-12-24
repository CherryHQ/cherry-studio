import type { JSONContent } from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { describe, expect, it } from 'vitest'

import { YamlFrontMatter } from '../yaml-front-matter'

const parseFrontMatters = (markdown: string) => {
  const manager = new MarkdownManager({
    extensions: [YamlFrontMatter]
  })
  const doc = manager.parse(markdown) as JSONContent
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

  it('treats later front matter markers as regular markdown when content already exists', () => {
    const markdown = `Intro paragraph

---
title: Should not parse
---`

    const contents = parseFrontMatters(markdown)
    expect(contents).toHaveLength(0)
  })
})
