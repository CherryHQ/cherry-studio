import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

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
})
