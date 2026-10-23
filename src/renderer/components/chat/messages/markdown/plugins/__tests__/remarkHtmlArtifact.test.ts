import type { Root } from 'mdast'
import remarkParse from 'remark-parse'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'

import { remarkLatexMath } from '@renderer/utils/remarkLatexMath'

import { classifyHtmlArtifactSource, remarkHtmlArtifact } from '../remarkHtmlArtifact'

function parse(source: string, withLatexMath = false): Root {
  const processor = withLatexMath
    ? unified().use(remarkParse).use(remarkLatexMath).use(remarkHtmlArtifact)
    : unified().use(remarkParse).use(remarkHtmlArtifact)
  return processor.runSync(processor.parse(source), { value: source })
}

describe('remarkHtmlArtifact', () => {
  it('converts top-level raw HTML regions into HTML code nodes', () => {
    const tree = parse(`## Before

<div><strong>First preview</strong></div>

### Between

<div class="card">Second preview</div>

### After`)

    expect(tree.children.map((child) => child.type)).toEqual(['heading', 'code', 'heading', 'code', 'heading'])
    expect(tree.children[1]).toMatchObject({
      type: 'code',
      lang: 'html',
      value: '<div><strong>First preview</strong></div>'
    })
    expect(tree.children[3]).toMatchObject({
      type: 'code',
      lang: 'html',
      value: '<div class="card">Second preview</div>'
    })
  })

  it('converts an incomplete top-level HTML block while streaming', () => {
    const tree = parse('<div><span>Still generating')

    expect(tree.children[0]).toMatchObject({
      type: 'code',
      lang: 'html',
      value: '<div><span>Still generating'
    })
  })

  it('keeps a complete HTML document with blank lines in one code node', () => {
    const source = `<!doctype html>
<html>
<head>
  <title>Demo</title>

  <style>body { color: red; }</style>
</head>

<body>
  <h1>Hello</h1>
</body>
</html>`
    const tree = parse(source)

    expect(tree.children).toEqual([
      expect.objectContaining({
        type: 'code',
        lang: 'html',
        value: source
      })
    ])
  })

  it('keeps Markdown-shaped text inside a complete HTML document', () => {
    const source = `<!doctype html>
<html><body>

Hello

</body></html>`
    const tree = parse(source)

    expect(tree.children).toEqual([
      expect.objectContaining({
        type: 'code',
        lang: 'html',
        value: source
      })
    ])
  })

  it('keeps LaTeX delimiters inside HTML artifacts as source text', () => {
    const source = '<div>\\(html\\)</div>'
    const tree = parse(source, true)

    expect(tree.children).toEqual([
      expect.objectContaining({
        type: 'code',
        lang: 'html',
        value: source
      })
    ])
  })

  it('leaves an incomplete HTML document on the Markdown path', () => {
    const tree = parse(`<html><body>

Still generating`)

    expect(tree.children.some((child) => child.type === 'code')).toBe(false)
    expect(tree.children[0]).toMatchObject({ type: 'html', value: '<html><body>' })
  })

  it('leaves inline HTML inside Markdown paragraphs unchanged', () => {
    const tree = parse('Text with <span>inline HTML</span>.')

    expect(tree.children[0]).toMatchObject({
      type: 'paragraph',
      children: [{ type: 'text' }, { type: 'html' }, { type: 'text' }, { type: 'html' }, { type: 'text' }]
    })
  })

  it('does not create a preview for comments or a standalone doctype', () => {
    const tree = parse('<!-- internal note -->\n\n<!doctype html>')

    expect(tree.children).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: 'html', value: '<!-- internal note -->' })])
    )
    expect(tree.children.every((child) => child.type === 'html')).toBe(true)
  })

  it('keeps SVG in the dedicated Markdown SVG renderer path', () => {
    const tree = parse('<svg viewBox="0 0 10 10"><circle cx="5" cy="5" r="5" /></svg>')

    expect(tree.children).not.toEqual(expect.arrayContaining([expect.objectContaining({ type: 'code' })]))
    expect(tree.children[0]).toMatchObject({
      type: 'paragraph',
      children: expect.arrayContaining([
        expect.objectContaining({ type: 'html', value: expect.stringContaining('<svg') })
      ])
    })
  })

  // Paired container boundaries wrapping Markdown must stay raw HTML (#21456): CommonMark
  // splits `<details>…</summary>` / `</details>` into two top-level html nodes around the
  // body, and converting each into an artifact iframe shatters the disclosure (a white summary
  // bar, the body outside, and a blank iframe for the closing tag).
  it('keeps paired container boundaries raw so Markdown stays inside the element', () => {
    const source = `Before

<details>
<summary>Answer (click to expand)</summary>

**Quick check:** hidden while closed.

</details>

After`
    const tree = parse(source)

    expect(tree.children.map((child) => child.type)).toEqual(['paragraph', 'html', 'paragraph', 'html', 'paragraph'])
    expect(tree.children[1]).toMatchObject({ type: 'html' })
    expect((tree.children[1] as { value: string }).value).toContain('<details>')
    expect(tree.children[3]).toMatchObject({ type: 'html', value: '</details>' })
  })

  it('never pairs on tag-like text inside comments, raw-text bodies or attributes', () => {
    const source = `Before

<details>
<summary>Answer</summary>

<script>const example = "</details>";</script>

<!-- </details> -->

<div title="</details>">still hidden</div>

</details>

After`
    const tree = parse(source)

    // Only the real boundaries stay raw HTML: the script and the attribute decoy take the
    // artifact path (code nodes), and the comment passes through without closing anything.
    const htmlValues = tree.children.filter((child) => child.type === 'html').map((child) => child.value)
    expect(htmlValues).toEqual(['<details>\n<summary>Answer</summary>', '<!-- </details> -->', '</details>'])
  })

  it('keeps an unfinished streamed comment from pairing on tag-like text inside it', () => {
    const source = `<details>
<summary>Outer</summary>

Body

<!-- note </details>`
    const tree = parse(source)

    // A streamed comment prefix swallows the rest of the input until `-->`: the decoy inside
    // must not pair the disclosure into a native collapsed element hiding `Body` — the
    // unpaired opening keeps the artifact path like base.
    expect(tree.children.map((child) => child.type)).toEqual(['code', 'paragraph', 'code'])
    expect(tree.children[0]).toMatchObject({
      type: 'code',
      lang: 'html',
      value: expect.stringContaining('<details>')
    })
    expect(tree.children[1]).toMatchObject({ type: 'paragraph', children: [{ value: 'Body' }] })
  })

  it('keeps both disclosures raw when the close and the next open share one html node', () => {
    const source = `Before

<details>
<summary>First</summary>

</details>
<details>
<summary>Second</summary>

Second body.

</details>

After`
    const tree = parse(source)

    // CommonMark merges `</details>\n<details>…` into one html node: the pairing must exempt
    // only the close and re-process the remainder as the second disclosure's opening, so its
    // own close never becomes an artifact preview.
    expect(tree.children.map((child) => child.type)).toEqual([
      'paragraph',
      'html',
      'html',
      'html',
      'paragraph',
      'html',
      'paragraph'
    ])
    const htmlValues = tree.children.filter((child) => child.type === 'html').map((child) => child.value)
    expect(htmlValues).toEqual([
      '<details>\n<summary>First</summary>',
      '</details>',
      '<details>\n<summary>Second</summary>',
      '</details>'
    ])
  })

  it('keeps the document artifact when a raw-text body with a literal close spans html nodes', () => {
    const source = `<details>
<summary>Doc</summary>

<html><body><textarea>

</details>

</textarea>
<style>p { color: red; }</style><p>Doc</p></body></html>

</details>`
    const tree = parse(source)

    // The blank lines split the document into several html nodes, so the textarea body is not
    // consumed by a same-node match: the lexical raw-text state must carry across nodes so the
    // literal `</details>` never closes the disclosure and the document still assembles ONE
    // artifact instead of leaking through Markdown sanitization (which strips <style>).
    expect(tree.children.map((child) => child.type)).toEqual(['html', 'code', 'html'])
    expect(tree.children[1]).toMatchObject({
      type: 'code',
      lang: 'html',
      value: expect.stringContaining('<html><body><textarea>')
    })
    const document = (tree.children[1] as { value: string }).value
    expect(document).toContain('</details>')
    expect(document).toContain('</textarea>')
    expect(document).toContain('<style>p { color: red; }</style>')
    expect(document).toContain('</html>')
    expect((tree.children[2] as { value: string }).value).toBe('</details>')
  })

  it('keeps the raw-text state alive across several continuation nodes before its end tag', () => {
    const source = `<details>
<summary>Doc</summary>

<html><body><textarea>

</details>

</details>

</textarea>
<style>p { color: red; }</style><p>Doc</p></body></html>

</details>`
    const tree = parse(source)

    // The textarea body spans MULTIPLE html nodes without its end tag: the raw-text state must
    // survive every continuation node until `</textarea>` shows up, so neither literal
    // `</details>` ends the disclosure and the document still assembles ONE artifact.
    expect(tree.children.map((child) => child.type)).toEqual(['html', 'code', 'html'])
    expect(tree.children[1]).toMatchObject({
      type: 'code',
      lang: 'html',
      value: expect.stringContaining('<html><body><textarea>')
    })
    const document = (tree.children[1] as { value: string }).value
    expect(document).toContain('</textarea>')
    expect(document).toContain('<style>p { color: red; }</style>')
    expect(document).toContain('</html>')
    expect((tree.children[2] as { value: string }).value).toBe('</details>')
  })

  it('never pairs on a literal close inside a same-node noembed raw-text body', () => {
    const source = `<details>
<summary>Spec</summary>

<html><body><noembed>literal </details> text</noembed></body></html>

</details>

After`
    const tree = parse(source)

    // `noembed` is a raw-text element like xmp/iframe: its literal `</details>` must not end
    // the disclosure search inside the document, and only the real boundary stays raw.
    expect(tree.children.map((child) => child.type)).toEqual(['html', 'code', 'html', 'paragraph'])
    expect(tree.children[1]).toMatchObject({
      type: 'code',
      lang: 'html',
      value: expect.stringContaining('<noembed>literal </details> text</noembed>')
    })
    expect((tree.children[2] as { value: string }).value).toBe('</details>')
  })

  it('never pairs on </details> inside quoted attribute values', () => {
    const source = `Before

<details>
<summary>Spec</summary>

<div title="> </details>">Doc</div>

</details>

After`
    const tree = parse(source)

    // A `>` inside a quoted attribute value is legal HTML: the decoy must be consumed as part
    // of the tag, and only the real boundary closes the disclosure.
    const htmlValues = tree.children.filter((child) => child.type === 'html').map((child) => child.value)
    expect(htmlValues).toEqual(['<details>\n<summary>Spec</summary>', '</details>'])
    const codeValues = tree.children.filter((child) => child.type === 'code').map((child) => child.value)
    expect(codeValues.some((value) => value.includes('title="> </details>"'))).toBe(true)
  })

  it('keeps the artifact path for a multi-node document whose end shares the close node', () => {
    const source = `<details>
<summary>Spec</summary>

<html><body>
<style>p { color: red; }</style>

<p>Doc</p>
</body></html></details>`
    const tree = parse(source)

    // Blank lines split the document across several html nodes and CommonMark merges the
    // document tail with `</details>` into one node: the body range plus the closing-node
    // prefix must still assemble ONE document artifact, not leak raw HTML.
    expect(tree.children.map((child) => child.type)).toEqual(['html', 'code', 'html'])
    expect(tree.children[1]).toMatchObject({
      type: 'code',
      lang: 'html',
      value: expect.stringContaining('<style>p { color: red; }</style>')
    })
    expect((tree.children[1] as { value: string }).value).toContain('</html>')
    expect((tree.children[2] as { value: string }).value).toBe('</details>')
  })

  it('consumes quoted attributes on disclosure opens and raw-text bodies when pairing', () => {
    const source = `<details>
<summary>Outer</summary>

<html><body><details title="</details>">Inner</details><xmp>not a boundary: </details></xmp><style>p { color: red; }</style></body></html>

<iframe>fallback </details> text</iframe>

</details>

After`
    const tree = parse(source)

    // A `</details>` inside the open tag's quoted attribute or an iframe/xmp raw-text body is
    // legal HTML that must never close the outer disclosure; the embedded document keeps the
    // artifact path and only the real boundary stays raw.
    expect(tree.children.map((child) => child.type)).toEqual(['html', 'code', 'code', 'html', 'paragraph'])
    expect(tree.children[1]).toMatchObject({
      type: 'code',
      lang: 'html',
      value: expect.stringContaining('<style>p { color: red; }</style>')
    })
    expect((tree.children[2] as { value: string }).value).toContain('<iframe>')
    expect((tree.children[3] as { value: string }).value).toBe('</details>')
  })

  it('routes document content sharing the close node through the artifact path', () => {
    const source = `Before

<details>
<summary>Spec</summary>

<html><body><style>p { color: red; }</style><p>Doc</p></body></html></details>

After`
    const tree = parse(source)

    // The complete document before the close takes the artifact path on its own; only the
    // boundary itself is exempted as raw HTML.
    expect(tree.children.map((child) => child.type)).toEqual(['paragraph', 'html', 'code', 'html', 'paragraph'])
    expect((tree.children[2] as { value: string }).value).toContain('<html>')
    expect((tree.children[3] as { value: string }).value).toBe('</details>')
  })

  it('still processes Markdown inside paired containers', () => {
    const source = `<details>
<summary>Math</summary>

$$
y = 1
$$

</details>`
    const tree = parse(source, true)

    // The body stays on the Markdown path (downstream math/KaTeX plugins re-process it);
    // only the boundary nodes are exempt from artifact conversion.
    expect(tree.children.map((child) => child.type)).toEqual(['html', 'paragraph', 'html'])
    const body = tree.children[1] as { children: Array<{ value?: string }> }
    expect(body.children.map((child) => child.value ?? '').join('')).toContain('y = 1')
  })

  it('keeps unpaired fragments on the artifact preview path', () => {
    const tree = parse(`<details>
<summary>Streaming</summary>

Body text`)

    expect(tree.children[0]).toMatchObject({ type: 'code', lang: 'html' })
  })

  // Nesting-aware pairing: an outer disclosure must pair with ITS OWN closing node, not the
  // inner disclosure's close — otherwise the stray outer `</details>` falls into the artifact
  // preview path as a closing-tag artifact and the native disclosure loses its boundary.
  it('pairs nested disclosures with their own closing nodes', () => {
    const source = `<details>
<summary>Outer</summary>

<details>
<summary>Inner</summary>

Inner body

</details>

Outer tail

</details>`
    const tree = parse(source)

    expect(tree.children.map((child) => child.type)).toEqual(
      expect.arrayContaining(['html', 'html', 'paragraph', 'html', 'paragraph', 'html'])
    )
    expect(tree.children.map((child) => child.type)).not.toContain('code')
    const values = tree.children.map((child) => (child.type === 'html' ? (child as { value: string }).value : ''))
    expect(values.filter((value) => value.startsWith('<details')).length).toBe(2)
    expect(values.filter((value) => value.startsWith('</details')).length).toBe(2)
  })

  // Adjacent opening lines without a blank line merge into ONE html node holding both
  // openings: every retained opening must keep its close raw — otherwise the inner close
  // collapses into a code node and the outer disclosure swallows the following prose.
  it('closes every disclosure retained in a shared opening node before the following prose', () => {
    const source = `<details><summary>Outer</summary>
<details><summary>Inner</summary>

Inner body

</details>

Outer tail

</details>

After`
    const tree = parse(source)

    expect(tree.children.map((child) => child.type)).toEqual([
      'html',
      'paragraph',
      'html',
      'paragraph',
      'html',
      'paragraph'
    ])
    const htmlValues = tree.children.filter((child) => child.type === 'html').map((child) => child.value)
    expect(htmlValues.filter((value) => value.startsWith('<details')).length).toBe(1)
    expect(htmlValues.filter((value) => value.startsWith('</details')).length).toBe(2)
    // `After` renders after the outer close, outside both disclosures.
    expect(tree.children.at(-1)).toMatchObject({
      type: 'paragraph',
      children: [{ value: 'After' }]
    })
  })

  // The document ending in the SAME html node as the inner close must not swallow that close
  // into the artifact: both retained openings need their raw closes or the outer disclosure
  // swallows the following prose.
  it('keeps a retained close out of a document artifact sharing its node', () => {
    const source = `<details><summary>Outer</summary>
<details><summary>Inner</summary>

<html><body>Doc</body></html></details>

</details>

After`
    const tree = parse(source)

    expect(tree.children.map((child) => child.type)).toEqual(['html', 'code', 'html', 'html', 'paragraph'])
    expect(tree.children[1]).toMatchObject({
      type: 'code',
      lang: 'html',
      value: '<html><body>Doc</body></html>'
    })
    const htmlValues = tree.children.filter((child) => child.type === 'html').map((child) => child.value)
    expect(htmlValues.filter((value) => value.startsWith('</details')).length).toBe(2)
    // `After` renders after the outer close, outside both disclosures.
    expect(tree.children.at(-1)).toMatchObject({
      type: 'paragraph',
      children: [{ value: 'After' }]
    })
  })

  // Only the matched boundaries are exempt; the body keeps the normal processing, so an HTML
  // document inside a disclosure still becomes an artifact code node instead of leaking into
  // Markdown sanitization (which strips <style>).
  it('keeps the artifact path for an HTML document inside a paired disclosure', () => {
    const source = `<details>
<summary>Spec</summary>

<html><body><style>p { color: red; }</style><p>Doc</p></body></html>

Plain tail

</details>`
    const tree = parse(source)

    expect(tree.children.map((child) => child.type)).toEqual(['html', 'code', 'paragraph', 'html'])
    expect(tree.children[1]).toMatchObject({
      type: 'code',
      lang: 'html',
      value: expect.stringContaining('<style>p { color: red; }</style>')
    })
  })

  // A raw-text body whose end tag arrives in a LATER node must not make the close search
  // wander backward: `<textarea>one</textarea><textarea>two` leaves the second body open,
  // and a non-offset close search would find the FIRST `</textarea>` again — moving the
  // cursor backward into an infinite synchronous loop on the rendering path.
  it('terminates when consecutive raw-text elements leave the second body open across nodes', () => {
    const source = `<details>
<summary>Spec</summary>

<div><textarea>one</textarea><textarea>two

</details>

After`
    const tree = parse(source)

    // The unclosed second textarea keeps the disclosure unpaired (the trailing `</details>`
    // is textarea body text): every html fragment stays on the artifact path and the trailing
    // prose renders as a paragraph, not as disclosure body.
    expect(tree.children.map((child) => child.type)).toEqual(['code', 'code', 'code', 'paragraph'])
    expect((tree.children[1] as { value: string }).value).toContain('<textarea>two')
    expect(tree.children.some((child) => child.type === 'html')).toBe(false)
  })

  // A streamed tag with an unterminated quoted attribute (`<div title="`) is tag interior:
  // the literal `</details>` inside the quote is attribute VALUE, never a boundary — the
  // unmatched opening keeps its artifact path and the body stays visible.
  it('never pairs on </details> inside an unfinished quoted attribute', () => {
    const source = `<details><summary>Answer</summary>

Body

<div title="</details>`
    const tree = parse(source)

    // The opening did not become a native collapsed disclosure around `Body`: the unmatched
    // opening and the unterminated tag both stay on the artifact path, `Body` stays visible.
    expect(tree.children.map((child) => child.type)).toEqual(['code', 'paragraph', 'code'])
    expect((tree.children[0] as { value: string }).value).toContain('<details>')
    expect((tree.children[2] as { value: string }).value).toContain('<div title=')
  })

  // A complete tag whose quoted attribute spans blank-line-separated nodes carries the same
  // literal across node borders: the quote state must survive until the attribute closes, or
  // the embedded document is cut short and loses its artifact assembly.
  it('keeps quote state across nodes for a multiline quoted attribute inside a paired disclosure', () => {
    const source = `<details>
<summary>Spec</summary>

<div title="</details>

<p>more</p>">

<html><body>Doc</body></html>

</details>`
    const tree = parse(source)

    // The real close is the LAST `</details>`: the embedded document still assembles one
    // artifact and the final boundary stays raw.
    expect(tree.children.at(-1)).toMatchObject({ type: 'html', value: '</details>' })
    const docNode = tree.children.find(
      (child) => child.type === 'code' && (child as { value: string }).value.includes('<html>')
    )
    expect(docNode).toBeDefined()
    expect((docNode as { value: string }).value).toContain('</html>')
    expect((docNode as { value: string }).value).not.toContain('</details>')
  })

  // A multiline raw-text OPENING tag (`<textarea title="…` spanning nodes) must remember the
  // element name while its attribute list completes: once the tag finishes, the raw-text body
  // starts — the literal `</details>` inside it is body text, not a boundary.
  it('enters raw-text state when a multiline textarea opener completes across nodes', () => {
    const source = `<details>
<summary>Spec</summary>

<html><body>
<textarea title="example

<div>continued">literal </details>

</textarea>
<style>p { color: red; }</style>
</body></html>

</details>

After`
    const tree = parse(source)

    // The document assembles through the multiline attribute nodes; the literal close inside
    // the textarea body does not end the disclosure, and `After` stays outside.
    expect(tree.children.at(-2)).toMatchObject({ type: 'html', value: '</details>' })
    expect(tree.children.at(-1)).toMatchObject({ type: 'paragraph' })
    const docNode = tree.children.find(
      (child) => child.type === 'code' && (child as { value: string }).value.includes('<html>')
    )
    expect(docNode).toBeDefined()
    expect((docNode as { value: string }).value).toContain('</textarea>')
    expect((docNode as { value: string }).value).toContain('</html>')
  })

  // Foreign-content CDATA sections are text: a `</details>` inside `<![CDATA[…]]>` is never a
  // boundary, and the wrapped document keeps its exact artifact source.
  it('never pairs on </details> inside SVG CDATA in an embedded document', () => {
    const source = `<details>
<summary>Spec</summary>

<html><body><svg><text><![CDATA[literal </details>]]></text></svg><style>p { color: red; }</style></body></html>

</details>`
    const tree = parse(source)

    expect(tree.children.map((child) => child.type)).toEqual(['html', 'code', 'html'])
    const docNode = tree.children[1] as { value: string }
    expect(docNode.value).toContain('<![CDATA[literal </details>]]>')
    expect(docNode.value).toContain('<style>p { color: red; }</style>')
    expect((tree.children[2] as { value: string }).value).toBe('</details>')
  })

  // `<plaintext>` swallows everything to end-of-input — it has no end tag, so apparent
  // closers after it are body text. The unmatched opening keeps its artifact path and the
  // body stays visible (never collapsed into a native disclosure on the literal).
  it('never pairs on </details> after a plaintext element (runs to EOF)', () => {
    const source = `<details>
<summary>Answer</summary>

Body

<div><plaintext>literal </details>

</details>

After`
    const tree = parse(source)

    // Unpaired: every fragment keeps the artifact path, `Body` and `After` stay visible.
    expect(tree.children.map((child) => child.type)).toEqual(['code', 'paragraph', 'code', 'code', 'paragraph'])
    expect((tree.children[1] as { children?: unknown[] }).children).toBeDefined()
    expect((tree.children[4] as { children?: unknown[] }).children).toBeDefined()
    expect(tree.children.some((child) => child.type === 'html')).toBe(false)
  })

  // The EOF semantics hold across blank-line-split nodes too: once `<plaintext>` opens,
  // nothing in any later node closes the pairing.
  it('keeps plaintext body across nodes until end-of-input', () => {
    const source = `<details>
<summary>Answer</summary>

<div><plaintext>

Body

</details>

After`
    const tree = parse(source)

    // Fragments: [open, `<div><plaintext>`, `</details>`] all on the artifact path.
    expect(tree.children.map((child) => child.type)).toEqual(['code', 'code', 'paragraph', 'code', 'paragraph'])
    expect(tree.children.some((child) => child.type === 'html')).toBe(false)
  })

  // The retained-close fallback must carry lexical state across body nodes: a textarea
  // spanning several nodes holds a literal `</details>` that is NOT the inner close.
  it('resolves retained closes with cross-node lexical state', () => {
    const source = `<details><summary>One</summary><details><summary>Two</summary>

<div><textarea>

</details>

</textarea>
</div>

inner two

</details>

</details>`
    const tree = parse(source)

    // Shape: [shared open raw, div+textarea code, literal close CODE (textarea body — never
    // a retained close), textarea/div tail code, `inner two` paragraph, two real closes raw].
    const types = tree.children.map((child) => child.type)
    expect(types).toEqual(['html', 'code', 'code', 'code', 'paragraph', 'html', 'html'])
    const htmlValues = tree.children.filter((child) => child.type === 'html').map((child) => child.value)
    expect(htmlValues[0]).toContain('<details>')
    expect(htmlValues[1]).toBe('</details>')
    expect(htmlValues[2]).toBe('</details>')
    const literalIndex = types.findIndex(
      (type, index) => type === 'code' && (tree.children[index] as { value: string }).value === '</details>'
    )
    expect(literalIndex).toBe(2)
    const body = tree.children.find(
      (child) => child.type === 'paragraph' && JSON.stringify(child).includes('inner two')
    )
    expect(body).toBeDefined()
  })

  // The paired body re-enters processing with the OPENING node's lexical state: a textarea
  // opened beside the shared openings holds the following `</details>` as literal text, so
  // the retained-close resolution must not fire on it and the REAL inner close stays raw —
  // otherwise the inner close collapses into code and the following prose hides inside the
  // outer disclosure.
  it('carries the opening node lexical state into the paired body scan', () => {
    const source = `<details><summary>Outer</summary><details><summary>Inner</summary><textarea>

</details>

</textarea>

Inner body

</details>

</details>

After`
    const tree = parse(source)

    // Shape: [shared open raw, literal close CODE (textarea body), `</textarea>` CODE,
    // `Inner body` paragraph, the real inner close raw, the outer close raw, `After` outside].
    expect(tree.children.map((child) => child.type)).toEqual([
      'html',
      'code',
      'code',
      'paragraph',
      'html',
      'html',
      'paragraph'
    ])
    const htmlValues = tree.children.filter((child) => child.type === 'html').map((child) => child.value)
    expect(htmlValues.filter((value) => value.startsWith('</details')).length).toBe(2)
    expect(tree.children.at(-1)).toMatchObject({
      type: 'paragraph',
      children: [{ value: 'After' }]
    })
  })

  // The retained-close resolution must keep the depth accumulated across the body's own
  // nested openings: a `<details>` opened inside a `<div>` in the body raises the depth, so
  // its close is NOT the retained boundary — re-arming the seed before every node would
  // forget the opening and emit Third's close as Inner's, exposing `Inner body` outside the
  // collapsed disclosure.
  it('preserves accumulated nesting depth across HTML body nodes', () => {
    const source = `<details open><summary>Outer</summary><details><summary>Inner</summary>

<div><details><summary>Third</summary>

Third body

</details></div>

Inner body

</details>

</details>

After`
    const tree = parse(source)

    // Shape: [shared open raw, Third's opening CODE, `Third body` paragraph, Third's close
    // CODE, `Inner body` paragraph, the real inner close raw, the outer close raw, `After`].
    expect(tree.children.map((child) => child.type)).toEqual([
      'html',
      'code',
      'paragraph',
      'code',
      'paragraph',
      'html',
      'html',
      'paragraph'
    ])
    const htmlValues = tree.children.filter((child) => child.type === 'html').map((child) => child.value)
    expect(htmlValues.filter((value) => value.startsWith('</details')).length).toBe(2)
    expect(tree.children.at(-1)).toMatchObject({
      type: 'paragraph',
      children: [{ value: 'After' }]
    })
  })

  // Script data has its own tokenizer states: after `<!--` a literal `<script>` re-enters
  // double-escaping, where a `</script>` only steps back to escaped — the element really ends
  // at the LAST `</script>`, and the `</details>` between them is script source, never a
  // boundary.
  it('never pairs on the literal close inside script escaped regions', () => {
    const source = `<details>
<summary>Spec</summary>

<script>const template="<!--<script></script> literal </details>";</script>

</details>

After`
    const tree = parse(source)

    expect(tree.children.map((child) => child.type)).toEqual(['html', 'code', 'html', 'paragraph'])
    expect(tree.children[1]).toMatchObject({
      type: 'code',
      lang: 'html',
      value: '<script>const template="<!--<script></script> literal </details>";</script>'
    })
    expect((tree.children[2] as { value: string }).value).toBe('</details>')
  })

  // The same state machine keeps a complete document inside a disclosure ONE exact-source
  // artifact: the literal close inside the script string must not split the document or pair
  // the disclosure early.
  it('keeps the exact document artifact when a script string hides a literal close', () => {
    const document = `<!doctype html>
<html>
<body>
<script>const template="<!--<script></script> literal </details>";</script>
<style>p { color: red; }</style>
</body>
</html>`
    const source = `<details>
<summary>Doc</summary>

${document}

</details>

After`
    const tree = parse(source)

    expect(tree.children.map((child) => child.type)).toEqual(['html', 'code', 'html', 'paragraph'])
    expect(tree.children[1]).toMatchObject({ type: 'code', lang: 'html', value: document })
    const htmlValues = tree.children.filter((child) => child.type === 'html').map((child) => child.value)
    expect(htmlValues).toEqual(['<details>\n<summary>Doc</summary>', '</details>'])
    expect(tree.children.at(-1)).toMatchObject({ type: 'paragraph', children: [{ value: 'After' }] })
  })

  // `<plaintext>` has NO end tag, so `</plaintext>` is literal text and everything after it
  // runs to end-of-input: the same-node pairing shortcut must not consume the apparent close
  // and pair the disclosure on the following literal — the opening keeps its unpaired
  // fragment path and `Body` stays visible.
  it('never pairs on a same-node plaintext literal close', () => {
    const source = `<details><summary>Answer</summary>

Body

<div><plaintext>literal </plaintext> </details>

After`
    const tree = parse(source)

    expect(tree.children.map((child) => child.type)).toEqual(['code', 'paragraph', 'code', 'paragraph'])
    expect(tree.children.some((child) => child.type === 'html')).toBe(false)
    expect((tree.children[0] as { value: string }).value).toContain('<details>')
  })

  // The script tokenizer region also carries across blank-line-split html nodes: a body ending
  // inside `<!--<script>` leaves the NEXT node double-escaped, where its literal `</script>`
  // only steps back to escaped — the element never truly ends, so the trailing `</details>` is
  // script source and must not pair the disclosure, and the literal `</html>` inside the same
  // string is never a document boundary.
  it('carries script escaped regions across nodes until the true end tag', () => {
    const source = `<details>
<summary>Doc</summary>

<html><body><script>const a="<!--<script>

<div>literal </details>";</script></body></html>

</details>`
    const tree = parse(source)

    // The disclosure never pairs (no real `</script>` exists past the double-escaped region):
    // every fragment keeps its artifact path except the document-boundary fragments.
    expect(tree.children.map((child) => child.type)).toEqual(['code', 'html', 'html', 'code'])
    expect((tree.children[1] as { value: string }).value).toContain('<script>const a="<!--<script>')
    expect((tree.children[2] as { value: string }).value).toContain('literal </details>";')
    expect(
      tree.children.every(
        (child) => child.type !== 'html' || !(child as { value: string }).value.startsWith('</details')
      )
    ).toBe(true)
  })

  // The retained-close prefix recursion must inherit the lexical state accumulated BEFORE the
  // resolving node: a textarea opened in an earlier body node holds the prefix's own
  // `</details>` as literal text, so a fresh prefix scan would emit that literal raw and place
  // the outer tail outside the collapsed disclosure.
  it('carries the entry lexical state into the retained-close prefix recursion', () => {
    const source = `<details><summary>Outer</summary><details><summary>Inner</summary>

<div><textarea>

</details>
</textarea>
</details>

Outer tail

</details>

After`
    const tree = parse(source)

    // Shape: [shared open raw, `<div><textarea>` CODE, the prefix literal CODE (textarea body
    // — never a retained close), the real inner close raw, `Outer tail` (still inside Outer),
    // the outer close raw, `After` outside].
    expect(tree.children.map((child) => child.type)).toEqual([
      'html',
      'code',
      'code',
      'html',
      'paragraph',
      'html',
      'paragraph'
    ])
    const htmlValues = tree.children.filter((child) => child.type === 'html').map((child) => child.value)
    expect(htmlValues.filter((value) => value.startsWith('</details')).length).toBe(2)
    // `Outer tail` renders between the two raw closes (inside Outer), `After` after both.
    expect(tree.children[4]).toMatchObject({ type: 'paragraph', children: [{ value: 'Outer tail' }] })
    expect(tree.children.at(-1)).toMatchObject({ type: 'paragraph', children: [{ value: 'After' }] })
  })

  // HTML parsers ignore the trailing slash on a NON-void element's start tag: `<details/>`
  // opens a disclosure. Skipping it as self-closing lets the embedded document's own
  // `</details>` close the outer pairing early, splitting the document artifact.
  it('counts a slash-terminated details opener as an opening', () => {
    const document = `<html><body><details/><summary>Inner</summary><p>Card</p></details><style>p{color:red}</style></body></html>`
    const source = `<details>
<summary>Doc</summary>

${document}

</details>

After`
    const tree = parse(source)

    // The document's inner close belongs to `<details/>`: the outer pairing waits for the real
    // boundary, the document keeps one exact-source artifact and `After` stays outside.
    expect(tree.children.map((child) => child.type)).toEqual(['html', 'code', 'html', 'paragraph'])
    expect(tree.children[1]).toMatchObject({ type: 'code', lang: 'html', value: document })
    expect((tree.children[2] as { value: string }).value).toBe('</details>')
    expect(tree.children.at(-1)).toMatchObject({ type: 'paragraph', children: [{ value: 'After' }] })
  })

  // The document-end search must respect script context: a literal `</html>` inside a script
  // string is document TEXT. Matching it truncates the artifact inside the string and lets the
  // following literal `</details>` resolve as a native boundary.
  it('keeps the exact document artifact when a script string hides the html close', () => {
    const source = `<details><summary>Outer</summary><details><summary>Inner</summary>

<html><body><script>const example="</html></details>";</script><style>p{color:red}</style></body></html>

</details>

</details>

After`
    const tree = parse(source)

    // Shape: [shared open raw, the exact document source as ONE code node, the real inner
    // close raw, the outer close raw, `After` outside both disclosures].
    expect(tree.children.map((child) => child.type)).toEqual(['html', 'code', 'html', 'html', 'paragraph'])
    expect(tree.children[1]).toMatchObject({
      type: 'code',
      lang: 'html',
      value: `<html><body><script>const example="</html></details>";</script><style>p{color:red}</style></body></html>`
    })
    const htmlValues = tree.children.filter((child) => child.type === 'html').map((child) => child.value)
    expect(htmlValues.filter((value) => value.startsWith('</details')).length).toBe(2)
    expect(tree.children.at(-1)).toMatchObject({ type: 'paragraph', children: [{ value: 'After' }] })
  })

  // A literal `<` in document text (`1 < 2`) is not a tag opener: entering tag state for it
  // swallows the real `</html>` as the tag's terminator, so the document never assembles and
  // its stylesheet leaks through Markdown sanitization.
  it('keeps the document artifact when a literal < precedes the html close', () => {
    const source = `<details>
<summary>Doc</summary>

<html><body>
<style>p { color: red; }</style>

<p>1 < 2</html>

</details>

After`
    const tree = parse(source)

    expect(tree.children.map((child) => child.type)).toEqual(['html', 'code', 'html', 'paragraph'])
    const document = (tree.children[1] as { value: string }).value
    expect(document).toContain('<style>p { color: red; }</style>')
    expect(document).toContain('1 < 2</html>')
    expect((tree.children[2] as { value: string }).value).toBe('</details>')
    expect(tree.children.at(-1)).toMatchObject({ type: 'paragraph', children: [{ value: 'After' }] })
  })

  // CommonMark splits `<details>` and `<summary>` into separate nodes when a blank line
  // separates them. The summary is the disclosure's LABEL, not body content: converting it
  // into an artifact iframe leaves the native disclosure without a summary element, so the
  // browser shows its default "Details" label instead of the supplied one.
  it('keeps a separately parsed summary as the disclosure label', () => {
    const source = `<details>

<summary>Answer</summary>

Body

</details>`
    const tree = parse(source)

    expect(tree.children.map((child) => child.type)).toEqual(['html', 'html', 'paragraph', 'html'])
    expect(tree.children[0]).toMatchObject({ type: 'html', value: '<details>' })
    expect(tree.children[1]).toMatchObject({ type: 'html', value: '<summary>Answer</summary>' })
    expect(tree.children[3]).toMatchObject({ type: 'html', value: '</details>' })
  })

  // The summary label can share one html node with a following inner disclosure opener (no
  // blank line between them). Emitting the whole node as the label orphans that opener: the
  // inner close never finds a matching open and falls to the artifact path, and the following
  // prose renders inside the inner disclosure.
  it('keeps an inner opener sharing the summary node in the pairing bookkeeping', () => {
    const source = `<details>

<summary>Outer</summary>
<details><summary>Inner</summary>

Inner body

</details>

Outer tail

</details>

After.`
    const tree = parse(source)

    expect(tree.children.map((child) => child.type)).toEqual([
      'html',
      'html',
      'html',
      'paragraph',
      'html',
      'paragraph',
      'html',
      'paragraph'
    ])
    expect(tree.children[0]).toMatchObject({ type: 'html', value: '<details>' })
    expect(tree.children[1]).toMatchObject({ type: 'html', value: '<summary>Outer</summary>' })
    expect(tree.children[2]).toMatchObject({ type: 'html', value: '<details><summary>Inner</summary>' })
    expect(tree.children[4]).toMatchObject({ type: 'html', value: '</details>' })
    expect(tree.children[6]).toMatchObject({ type: 'html', value: '</details>' })
    expect(tree.children.at(-1)).toMatchObject({ type: 'paragraph', children: [{ value: 'After.' }] })
  })

  // Inside SVG (foreign content) the raw-text algorithm never applies and a self-closing
  // `<title/>` really ends the element: waiting for a `</title>` that never comes loses the
  // document's real `</html>`, and the raw HTML loses its stylesheet to Markdown sanitization.
  it('keeps the document artifact when an SVG self-closing title shares the body', () => {
    const source = `Before

<html><head><style>p{color:red}</style></head>

<body><svg><title/></svg><p>Card</p></body></html>

After.`
    const tree = parse(source)

    expect(tree.children.map((child) => child.type)).toEqual(['paragraph', 'code', 'paragraph'])
    expect(tree.children[1]).toMatchObject({
      type: 'code',
      lang: 'html',
      value: source.split('\n\n').slice(1, 3).join('\n\n')
    })
    expect(tree.children.at(-1)).toMatchObject({ type: 'paragraph', children: [{ value: 'After.' }] })
  })

  // An HTML comment between the summary label and the inner opener must not void the opener's
  // bookkeeping: the label split has to look past comments (and whitespace) before deciding the
  // rest of the node holds no disclosure opener, or the inner close lands on the artifact path.
  it('keeps an inner opener behind an HTML comment in the summary node in the bookkeeping', () => {
    const source = `<details>

<summary>Outer</summary>
<!-- note -->
<details><summary>Inner</summary>

Inner body

</details>

Outer tail

</details>

After.`
    const tree = parse(source)

    expect(tree.children.map((child) => child.type)).toEqual([
      'html',
      'html',
      'html',
      'paragraph',
      'html',
      'paragraph',
      'html',
      'paragraph'
    ])
    expect(tree.children[1]).toMatchObject({ type: 'html', value: '<summary>Outer</summary>' })
    expect(tree.children[2]).toMatchObject({ type: 'html', value: '<details><summary>Inner</summary>' })
    expect(tree.children[4]).toMatchObject({ type: 'html', value: '</details>' })
    expect(tree.children[6]).toMatchObject({ type: 'html', value: '</details>' })
    expect(tree.children.at(-1)).toMatchObject({ type: 'paragraph', children: [{ value: 'After.' }] })
  })

  // HTML ignores the self-closing marker on non-void elements: `<script/>` still opens a
  // raw-text script body whose `</details>` literal is source code, not a disclosure boundary.
  // Only foreign content (svg/math) treats the marker as a real close — inside a paired
  // disclosure the literal otherwise hijacks the pairing close and shreds the document.
  it('keeps the embedded document artifact when an HTML self-closing script opener hides a close', () => {
    const source = `<details>

<summary>Doc</summary>

<html><body><script/>const example="</details>";</script><style>p{color:red}</style><p>Card</p></body></html>

</details>

After.`
    const tree = parse(source)

    expect(tree.children.map((child) => child.type)).toEqual(['html', 'html', 'code', 'html', 'paragraph'])
    expect(tree.children[2]).toMatchObject({
      type: 'code',
      lang: 'html',
      value: source.split('\n\n')[2]
    })
    expect(tree.children.at(-1)).toMatchObject({ type: 'paragraph', children: [{ value: 'After.' }] })
  })

  // A pairing search starting at a later node must consult the lexical state carried from the
  // earlier nodes: a `<details>` literal inside a textarea body opened in a previous node is
  // TEXT, not an opener. Starting fresh treats it as real and consumes the inner disclosure's
  // close, leaving `After` hidden inside the collapsed outer disclosure.
  it('does not pair a disclosure literal inside carried raw-text state', () => {
    const source = `<details><summary>Outer</summary><details><summary>Inner</summary>

<div><textarea>

<details><summary>Literal example</summary>

</textarea></div>

</details>

</details>

After`
    const tree = parse(source)

    // Every html fragment stays on the artifact path (like base): no native disclosure is
    // fabricated from the textarea literal, and `After` renders as ordinary prose.
    expect(tree.children.map((child) => child.type)).toEqual([
      'code',
      'code',
      'code',
      'paragraph',
      'code',
      'code',
      'paragraph'
    ])
    expect(tree.children.some((child) => child.type === 'html')).toBe(false)
    expect(tree.children.at(-1)).toMatchObject({ type: 'paragraph', children: [{ value: 'After' }] })
  })

  describe('classifyHtmlArtifactSource', () => {
    it.each([
      ['<div>Fragment</div>', 'fragment'],
      ['<section class="a b">Fragment</section>', 'fragment'],
      ['<!-- note --><section>Fragment</section>', 'fragment'],
      ['<html><body>Document</body></html>', 'document'],
      ['<html lang="en"><body>Document</body></html>', 'document'],
      ['<!doctype html><html><body>Document</body></html>', 'document'],
      ['<!-- note --><!DOCTYPE html><html><body>Document</body></html>', 'document']
    ])('classifies complete HTML source: %s', (source, expected) => {
      expect(classifyHtmlArtifactSource(source)).toBe(expected)
    })

    it.each([
      ['', 'empty fence'],
      ['<', 'bare angle bracket'],
      ['<!doc', 'partial doctype'],
      ['<htm', 'partial html tag'],
      ['<di', 'partial fragment tag'],
      ['<div class="unfinished', 'unterminated attribute list']
    ])('withholds a verdict while the source is unclassifiable (%s)', (source) => {
      expect(classifyHtmlArtifactSource(source)).toBeUndefined()
    })

    it('never flips its verdict once a streamed document becomes classifiable', () => {
      const full = '<!doctype html>\n<html>\n<body><h1>Hi</h1></body>\n</html>'
      const verdicts = Array.from({ length: full.length }, (_, index) =>
        classifyHtmlArtifactSource(full.slice(0, index + 1))
      ).filter((verdict) => verdict !== undefined)

      expect(verdicts.length).toBeGreaterThan(0)
      expect(new Set(verdicts)).toEqual(new Set(['document']))
    })

    it('never flips its verdict once a streamed fragment becomes classifiable', () => {
      const full = '<div class="card"><h1>Hi</h1></div>'
      const verdicts = Array.from({ length: full.length }, (_, index) =>
        classifyHtmlArtifactSource(full.slice(0, index + 1))
      ).filter((verdict) => verdict !== undefined)

      expect(verdicts.length).toBeGreaterThan(0)
      expect(new Set(verdicts)).toEqual(new Set(['fragment']))
    })
  })
})
