// @vitest-environment jsdom

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { render } from '@testing-library/react'
import { createElement } from 'react'
import { describe, expect, it } from 'vitest'

import { GoogleLight } from '../providers/google/light'

const ICONS_DIR = join(__dirname, '..')

function collectTsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = join(dir, name)
    const stat = statSync(file)

    if (stat.isDirectory()) {
      return collectTsxFiles(file)
    }

    return file.endsWith('.tsx') ? [file] : []
  })
}

describe('icon SVG ids', () => {
  it('does not use static SVG ids or url refs in reusable icon components', () => {
    const offenders = collectTsxFiles(ICONS_DIR).flatMap((file) => {
      const source = readFileSync(file, 'utf8')
      const staticIds = [...source.matchAll(/\bid=(["'])(?!\{)(.*?)\1/g)].map((match) => match[2])
      const staticUrlRefs = [...source.matchAll(/url\(#(?!\$\{)([^)]+)\)/g)].map((match) => match[1])
      const staticHrefRefs = [...source.matchAll(/\b(?:href|xlinkHref)=(["'])#(.*?)\1/g)].map((match) => match[2])

      if (staticIds.length === 0 && staticUrlRefs.length === 0 && staticHrefRefs.length === 0) {
        return []
      }

      return [
        `${file}: ids=[${staticIds.join(', ')}], refs=[${staticUrlRefs.join(', ')}], hrefs=[${staticHrefRefs.join(', ')}]`
      ]
    })

    expect(offenders).toEqual([])
  })

  it('scopes SVG references per icon instance at runtime', () => {
    const { container } = render(createElement('div', null, createElement(GoogleLight), createElement(GoogleLight)))

    const icons = Array.from(container.querySelectorAll('svg'))

    expect(icons).toHaveLength(2)

    const ids = icons.flatMap((icon) => Array.from(icon.querySelectorAll('[id]'), (node) => node.id))

    expect(ids.length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)

    for (const icon of icons) {
      const localIds = new Set(Array.from(icon.querySelectorAll('[id]'), (node) => node.id))
      const refs = collectSvgReferences(icon)

      expect(refs.length).toBeGreaterThan(0)
      for (const ref of refs) {
        expect(localIds.has(ref)).toBe(true)
      }
    }
  })
})

function collectSvgReferences(svg: Element): string[] {
  const refs: string[] = []

  for (const element of Array.from(svg.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      for (const match of attribute.value.matchAll(/url\(#([^)]+)\)/g)) {
        const ref = match[1]
        if (ref) {
          refs.push(ref)
        }
      }

      if ((attribute.name === 'href' || attribute.name === 'xlink:href') && attribute.value.startsWith('#')) {
        refs.push(attribute.value.slice(1))
      }
    }
  }

  return refs
}
