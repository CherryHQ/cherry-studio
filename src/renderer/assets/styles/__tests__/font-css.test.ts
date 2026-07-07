import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

const css = readFileSync(join(process.cwd(), 'src/renderer/assets/styles/font.css'), 'utf8')

function windowsFontBlock() {
  return css.match(/body\[os='windows'\]\s*\{[\s\S]*?\}/)?.[0] ?? ''
}

describe('font.css', () => {
  it('prioritizes native Windows CJK UI fonts before Ubuntu', () => {
    const block = windowsFontBlock()

    expect(block).toContain("'Microsoft YaHei UI'")
    expect(block).toContain("'Microsoft YaHei'")
    expect(block.indexOf("'Microsoft YaHei UI'")).toBeLessThan(block.indexOf('Ubuntu'))
    expect(block.indexOf("'Microsoft YaHei'")).toBeLessThan(block.indexOf('Ubuntu'))
  })
})
