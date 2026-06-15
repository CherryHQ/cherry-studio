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
})
