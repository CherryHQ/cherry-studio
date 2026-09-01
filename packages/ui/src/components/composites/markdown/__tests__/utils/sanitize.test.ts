import rehypeParse from 'rehype-parse'
import rehypeStringify from 'rehype-stringify'
import { defaultRehypePlugins } from 'streamdown'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'

import { createMarkdownSanitizeSchema, rehypePrefixSvgReferences } from '../..'

describe('Markdown sanitize schema', () => {
  it('preserves common SVG content required for gradients and clipping', async () => {
    const { sanitize, harden } = defaultRehypePlugins as Record<string, any>
    const [sanitizeFn, schema] = sanitize
    const [hardenFn, hardenOptions] = harden
    const html = `
      <svg width="100" height="50" viewBox="0 0 100 50">
        <defs>
          <linearGradient id="g" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="red" />
            <stop offset="100%" stop-color="blue" />
          </linearGradient>
          <clipPath id="clip">
            <ellipse cx="50" cy="25" rx="40" ry="20" />
          </clipPath>
        </defs>
        <ellipse cx="50" cy="25" rx="40" ry="20" fill="url(#g)" clip-path="url(#clip)" />
      </svg>
    `

    const output = String(
      await unified()
        .use(rehypeParse, { fragment: true })
        .use(sanitizeFn, createMarkdownSanitizeSchema(schema))
        .use(rehypePrefixSvgReferences, schema.clobberPrefix)
        .use(hardenFn, hardenOptions)
        .use(rehypeStringify)
        .process(html)
    )

    expect(output).toContain('<linearGradient id="user-content-g" gradientUnits="userSpaceOnUse">')
    expect(output).toContain('<stop offset="0%" stop-color="red">')
    expect(output).toContain('<clipPath id="user-content-clip">')
    expect(output).toContain('<ellipse cx="50" cy="25" rx="40" ry="20">')
    expect(output).toContain('fill="url(#user-content-g)"')
    expect(output).toContain('clip-path="url(#user-content-clip)"')
  })

  it('keeps the default clobber prefix for non-SVG ids', async () => {
    const { sanitize } = defaultRehypePlugins as Record<string, any>
    const [sanitizeFn, schema] = sanitize

    const output = String(
      await unified()
        .use(rehypeParse, { fragment: true })
        .use(sanitizeFn, createMarkdownSanitizeSchema(schema))
        .use(rehypeStringify)
        .process('<h1 id="location">Title</h1>')
    )

    expect(output).toContain('<h1 id="user-content-location">Title</h1>')
  })

  it('strips raw style elements and SVG inline style attributes from untrusted markdown html', async () => {
    const { sanitize } = defaultRehypePlugins as Record<string, any>
    const [sanitizeFn, schema] = sanitize

    const output = String(
      await unified()
        .use(rehypeParse, { fragment: true })
        .use(sanitizeFn, createMarkdownSanitizeSchema(schema))
        .use(rehypeStringify)
        .process(
          [
            '<style>*{background:url("https://attacker.example/leak")}</style>',
            '<svg><rect width="10" height="10" style="background:url(https://attacker.example/svg-leak)"></rect></svg>',
            '<p>Safe</p>'
          ].join('')
        )
    )

    expect(output).toContain('<p>Safe</p>')
    expect(output).not.toContain('<style>')
    expect(output).not.toContain('style=')
    expect(output).not.toContain('attacker.example')
  })

  it('filters unsafe SVG link protocols while preserving fragment references', async () => {
    const { sanitize } = defaultRehypePlugins as Record<string, any>
    const [sanitizeFn, schema] = sanitize

    const output = String(
      await unified()
        .use(rehypeParse, { fragment: true })
        .use(sanitizeFn, createMarkdownSanitizeSchema(schema))
        .use(rehypeStringify)
        .process(
          '<svg><use href="#icon" xlink:href="#icon"></use><a href="javascript:alert(1)" xlink:href="javascript:alert(2)"></a></svg>'
        )
    )

    expect(output).toContain('href="#icon"')
    expect(output).toContain('xlink:href="#icon"')
    expect(output).not.toContain('javascript:')
  })

  it('preserves composer token placeholders without allowing unsafe span attributes', async () => {
    const { sanitize } = defaultRehypePlugins as Record<string, any>
    const [sanitizeFn, schema] = sanitize

    const output = String(
      await unified()
        .use(rehypeParse, { fragment: true })
        .use(sanitizeFn, createMarkdownSanitizeSchema(schema))
        .use(rehypeStringify)
        .process('<span data-composer-token-index="0" data-composer-token-block="block-1" onclick="alert(1)"></span>')
    )

    expect(output).toContain('<span data-composer-token-index="0" data-composer-token-block="block-1"></span>')
    expect(output).not.toContain('onclick')
  })

  it('keeps preview-safe semantic HTML while stripping active media behavior', async () => {
    const { sanitize } = defaultRehypePlugins as Record<string, any>
    const [sanitizeFn, schema] = sanitize

    const output = String(
      await unified()
        .use(rehypeParse, { fragment: true })
        .use(sanitizeFn, createMarkdownSanitizeSchema(schema))
        .use(rehypeStringify)
        .process(
          [
            '<mark>Important</mark>',
            '<u>Underline</u><small>Small</small>',
            '<progress value="72" max="100">72%</progress>',
            '<audio controls autoplay><source src="https://example.com/audio.mp3" type="audio/mpeg"></audio>',
            '<video controls autoplay width="320" poster="https://example.com/poster.png"><source src="https://example.com/video.mp4" type="video/mp4"></video>',
            '<iframe src="https://example.com/embed"></iframe>'
          ].join('')
        )
    )

    expect(output).toContain('<mark>Important</mark>')
    expect(output).toContain('<u>Underline</u><small>Small</small>')
    expect(output).toContain('<progress value="72" max="100">72%</progress>')
    expect(output).toContain('<audio controls>')
    expect(output).toContain('<video controls width="320" poster="https://example.com/poster.png">')
    expect(output).toContain('<source src="https://example.com/audio.mp3" type="audio/mpeg">')
    expect(output).toContain('<source src="https://example.com/video.mp4" type="video/mp4">')
    expect(output).not.toContain('autoplay')
    expect(output).not.toContain('iframe')
  })

  it('keeps color-only span styles and strips unsafe declarations', async () => {
    const { sanitize } = defaultRehypePlugins as Record<string, any>
    const [sanitizeFn, schema] = sanitize

    const output = String(
      await unified()
        .use(rehypeParse, { fragment: true })
        .use(sanitizeFn, createMarkdownSanitizeSchema(schema))
        .use(rehypeStringify)
        .process(
          [
            '<span style="color: #ef4444">Red</span>',
            '<span style="background-color: rgb(254, 226, 226)">Tint</span>',
            '<span style="color: red; background: url(https://attacker.example/leak)">Unsafe</span>'
          ].join('')
        )
    )

    expect(output).toContain('<span style="color: #ef4444">Red</span>')
    expect(output).toContain('<span style="background-color: rgb(254, 226, 226)">Tint</span>')
    expect(output).toContain('<span>Unsafe</span>')
    expect(output).not.toContain('attacker.example')
  })

  it('keeps schemeless workspace file links through sanitize while blocking file:/drive/unsafe protocols', async () => {
    // This exercises the sanitize schema in isolation. The production pipeline also runs
    // hardening, with local hrefs temporarily preserved around both security plugins.
    const { sanitize } = defaultRehypePlugins as Record<string, any>
    const [sanitizeFn, schema] = sanitize
    const run = (html: string) =>
      unified()
        .use(rehypeParse, { fragment: true })
        .use(sanitizeFn, createMarkdownSanitizeSchema(schema))
        .use(rehypeStringify)
        .process(html)
        .then(String)

    // Relative + POSIX-absolute workspace file links survive sanitize unchanged —
    // this is exactly what the markdown file-link (open-in-preview) feature relies on.
    expect(await run('<a href="./README.md">x</a>')).toContain('href="./README.md"')
    expect(await run('<a href=".agents/skills/gh-create-pr/SKILL.md">x</a>')).toContain(
      'href=".agents/skills/gh-create-pr/SKILL.md"'
    )
    expect(await run('<a href="/Users/alice/notes.md">x</a>')).toContain('href="/Users/alice/notes.md"')
    // In this isolated sanitize pass, drive paths (`c:`), file: URLs and unsafe protocols
    // are dropped. The production pipeline preserves supported drive paths around sanitization.
    expect(await run('<a href="C:/Users/Alice/README.md">x</a>')).not.toContain('C:/Users')
    expect(await run('<a href="file:///C:/Users/x.md">x</a>')).not.toContain('file:///C:/Users/x.md')
    expect(await run('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:')
  })

  it('keeps only opaque numeric citation ids', async () => {
    const { sanitize } = defaultRehypePlugins as Record<string, any>
    const [sanitizeFn, schema] = sanitize
    const output = String(
      await unified()
        .use(rehypeParse, { fragment: true })
        .use(sanitizeFn, createMarkdownSanitizeSchema(schema))
        .use(rehypeStringify)
        .process('<sup data-citation="2">2</sup><sup data-citation=\'{"url":"https://attacker.example"}\'>3</sup>')
    )

    expect(output).toContain('<sup data-citation="2">2</sup>')
    expect(output).toContain('<sup>3</sup>')
    expect(output).not.toContain('attacker.example')
  })

  it('keeps only the fixed classes emitted by GitHub alerts', async () => {
    const { sanitize } = defaultRehypePlugins as Record<string, any>
    const [sanitizeFn, schema] = sanitize
    const output = String(
      await unified()
        .use(rehypeParse, { fragment: true })
        .use(sanitizeFn, createMarkdownSanitizeSchema(schema))
        .use(rehypeStringify)
        .process(
          '<div class="markdown-alert markdown-alert-note injected"><p class="markdown-alert-title injected">Title</p></div>'
        )
    )

    expect(output).toContain('class="markdown-alert markdown-alert-note"')
    expect(output).toContain('class="markdown-alert-title"')
    expect(output).not.toContain('injected')
  })
})
