import type { Element, Root } from 'hast'
import rehypeParse from 'rehype-parse'
import rehypeStringify from 'rehype-stringify'
import { unified } from 'unified'
import { describe, expect, it } from 'vitest'

import { rehypePrefixSvgReferences } from '../../plugins/rehype-prefix-svg-refs'

const processHtml = (html: string, clobberPrefix = 'user-content-'): string => {
  return unified()
    .use(rehypeParse, { fragment: true })
    .use(rehypePrefixSvgReferences, clobberPrefix)
    .use(rehypeStringify)
    .processSync(html)
    .toString()
}

describe('rehypePrefixSvgReferences', () => {
  it('rewrites bare fragment references and url references inside SVGs', () => {
    const output = processHtml(`
      <svg>
        <defs>
          <linearGradient id="user-content-gradient"></linearGradient>
          <symbol id="user-content-icon"></symbol>
        </defs>
        <use href="#icon" xlink:href="#icon"></use>
        <rect fill="url(#gradient)" clip-path="url('#gradient')"></rect>
      </svg>
    `)

    expect(output).toContain('href="#user-content-icon"')
    expect(output).toContain('xlink:href="#user-content-icon"')
    expect(output).toContain('fill="url(#user-content-gradient)"')
    expect(output).toContain('clip-path="url(&#x27;#user-content-gradient&#x27;)"')
  })

  it('returns early when clobberPrefix is empty', () => {
    const output = processHtml('<svg><defs><symbol id="icon"></symbol></defs><use href="#icon"></use></svg>', '')

    expect(output).toContain('id="icon"')
    expect(output).toContain('href="#icon"')
    expect(output).not.toContain('user-content-icon')
  })

  it('rewrites array-valued SVG properties', () => {
    const tree: Root = {
      type: 'root',
      children: [
        {
          type: 'element',
          tagName: 'svg',
          properties: {},
          children: [
            {
              type: 'element',
              tagName: 'linearGradient',
              properties: { id: 'user-content-gradient' },
              children: []
            },
            {
              type: 'element',
              tagName: 'rect',
              properties: { values: ['url(#gradient)', '#gradient'] },
              children: []
            }
          ]
        } as Element
      ]
    }

    rehypePrefixSvgReferences()(tree)

    const rect = (tree.children[0] as Element).children[1] as Element
    expect(rect.properties.values).toEqual(['url(#user-content-gradient)', '#user-content-gradient'])
  })

  it('keeps same-id SVG references scoped to each SVG subtree', () => {
    const output = processHtml(`
      <svg data-diagram="one">
        <defs><linearGradient id="user-content-gradient-one"></linearGradient></defs>
        <rect fill="url(#gradient-one)"></rect>
      </svg>
      <svg data-diagram="two">
        <defs><linearGradient id="user-content-gradient-two"></linearGradient></defs>
        <rect fill="url(#gradient-two)"></rect>
      </svg>
    `)

    expect(output).toContain('fill="url(#user-content-gradient-one)"')
    expect(output).toContain('fill="url(#user-content-gradient-two)"')
    expect(output).not.toContain('fill="url(#gradient-one)"')
    expect(output).not.toContain('fill="url(#gradient-two)"')
  })
})
