import { describe, expect, it } from 'vitest'

import corpus from './corpus-cases.json'
import { maskIndentedCodeBlocksReference, maskIndentedCodeBlocksStepped } from '../scratchpadText'

// Byte-identity gate: the stepped state machine must reproduce the published
// reference forward scan exactly (mask output, block list, placeholder base)
// on every input - this is what makes it a safe streaming substrate.
function expectIdentical(text: string) {
  const a = maskIndentedCodeBlocksReference(text)
  const b = maskIndentedCodeBlocksStepped(text)
  expect(b.text).toBe(a.text)
  expect(b.blocks).toEqual(a.blocks)
  expect(b.placeholderBase).toBe(a.placeholderBase)
}

describe('stepped = reference identity', () => {
  it('spec corpus (202 cases)', () => {
    for (const c of corpus as Array<{ id: string; input: string }>) {
      try {
        expectIdentical(c.input)
      } catch (e) {
        throw new Error(`${c.id}: ${(e as Error).message}`)
      }
    }
  })

  it('line-structured fuzz', () => {
    const atoms = [
      'text', '# head', '```', '~~~', '- item', '1. item', '> quote', '> - qitem',
      '    code', '\tcode', '  > q', '>     qcode', '', '   ', '***', '---',
      '<thinking>', '</thinking>', '<div>', '</div>', '<script>', '</script>',
      '`tick`', 'a <thinking> b', '> > deep', '  - nested', '    - deepitem',
      '>    four', '     five', 'para line', '<textarea>', '</textarea>'
    ]
    let seed = 42
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    for (let iter = 0; iter < 400; iter++) {
      const n = 1 + Math.floor(rnd() * 12)
      const lines: string[] = []
      for (let j = 0; j < n; j++) lines.push(atoms[Math.floor(rnd() * atoms.length)])
      const text = lines.join('\n') + (rnd() < 0.5 ? '\n' : '')
      try {
        expectIdentical(text)
      } catch (e) {
        throw new Error(`fuzz ${iter} ${JSON.stringify(text)}: ${(e as Error).message}`)
      }
    }
  })
})
