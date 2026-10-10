import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

import { compile } from 'tailwindcss'
import { expect, it } from 'vitest'

const entry = resolve('src/renderer/assets/styles/tailwind.css')

async function loadStylesheet(id: string, base: string) {
  let path: string
  if (id.startsWith('.')) {
    path = resolve(base, id)
  } else if (id.startsWith('@cherrystudio/ui/')) {
    path = resolve('packages/ui/src', id.slice('@cherrystudio/ui/'.length))
  } else {
    let directory = base
    while (!existsSync(resolve(directory, 'node_modules', id, 'package.json'))) {
      const parent = dirname(directory)
      if (parent === directory) throw new Error(`Cannot resolve stylesheet ${id} from ${base}`)
      directory = parent
    }
    const packageDirectory = resolve(directory, 'node_modules', id)
    const pkg = JSON.parse(readFileSync(resolve(packageDirectory, 'package.json'), 'utf8'))
    path = resolve(packageDirectory, pkg.exports?.['.']?.style ?? pkg.exports?.['.']?.default ?? pkg.style ?? pkg.main)
  }
  return { path, base: dirname(path), content: readFileSync(path, 'utf8') }
}

function blockEnd(css: string, start: number): number {
  let depth = 0
  for (let index = css.indexOf('{', start); index < css.length; index++) {
    if (css[index] === '{') depth++
    else if (css[index] === '}' && --depth === 0) return index + 1
  }
  throw new Error('Unclosed CSS block')
}

it('emits hover-revealed controls without hover-capability media gates', async () => {
  const candidates = [
    ['opacity-0', /opacity:\s*(?:0|0%);/],
    ['pointer-events-none', /pointer-events:\s*none;/],
    ['grid-cols-[0fr]', /grid-template-columns:\s*0fr;/],
    ['group-hover/message:opacity-100', /opacity:\s*(?:1|100%);/],
    ['group-hover:opacity-100', /opacity:\s*(?:1|100%);/],
    ['group-hover:pointer-events-auto', /pointer-events:\s*auto;/],
    ['group-hover:grid-cols-[1fr]', /grid-template-columns:\s*1fr;/],
    ['group-hover/resource-list-group:opacity-100', /opacity:\s*(?:1|100%);/],
    ['group-hover/resource-list-group:flex', /display:\s*flex;/],
    ['hover:opacity-100', /opacity:\s*(?:1|100%);/],
    ['focus-within:opacity-100', /opacity:\s*(?:1|100%);/],
    ['[&:hover_.menubar]:opacity-100', /opacity:\s*(?:1|100%);/]
  ] as const
  const compiler = await compile(readFileSync(entry, 'utf8'), {
    base: dirname(entry),
    from: entry,
    loadStylesheet
  })
  const css = compiler.build(candidates.map(([candidate]) => candidate))
  const hoverMediaRanges = [...css.matchAll(/@media\s*\(\s*hover\s*:\s*hover\s*\)\s*\{/g)].map((match) => ({
    start: match.index,
    end: blockEnd(css, match.index)
  }))
  const gatedCandidates: string[] = []

  // Hidden controls must retain their reveal rules on hover:none devices, including keyboard focus.
  for (const [candidate, declaration] of candidates) {
    const selector = `.${candidate.replace(/[^a-zA-Z0-9_-]/g, '\\$&')}`
    const start = css.indexOf(selector)
    expect(start, `${candidate} must be emitted`).toBeGreaterThanOrEqual(0)
    const end = blockEnd(css, start)
    expect(css.slice(start, end), `${candidate} must apply its visibility or interaction state`).toMatch(declaration)
    if (hoverMediaRanges.some((range) => range.start < end && range.end > start)) {
      gatedCandidates.push(candidate)
    }
  }

  expect(
    gatedCandidates,
    'These controls cannot reveal on hover:none devices because their rules are media-gated'
  ).toEqual([])
})
