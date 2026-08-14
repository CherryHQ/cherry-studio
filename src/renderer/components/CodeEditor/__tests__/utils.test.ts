import { describe, expect, it, vi } from 'vitest'

import { getNormalizedExtension, prepareCodeChanges } from '../utils'

const hoisted = vi.hoisted(() => ({
  codeLanguages: {
    svg: { extensions: ['.svg'] },
    TypeScript: { aliases: ['ts-alias'], extensions: ['.ts'] }
  }
}))

vi.mock('@shared/utils/codeLanguages', () => ({
  codeLanguages: hoisted.codeLanguages
}))

describe('getNormalizedExtension', () => {
  it.each([
    ['custom mapping ahead of linguist', 'svg', 'xml'],
    ['case-insensitive custom mapping', 'SVG', 'xml'],
    ['linguist language name', 'TypeScript', 'ts'],
    ['case-insensitive linguist language name', 'typescript', 'ts'],
    ['linguist alias', 'ts-alias', 'ts'],
    ['leading-dot extension', '.json', 'json'],
    ['unmatched language', 'unknownLanguage', 'unknownLanguage']
  ])('normalizes %s', async (_label, language, expected) => {
    await expect(getNormalizedExtension(language)).resolves.toBe(expected)
  })
})

describe('prepareCodeChanges', () => {
  const applyChanges = (source: string, changes: ReturnType<typeof prepareCodeChanges>) =>
    changes.reduceRight(
      (content, { from, insert, to }) => `${content.slice(0, from)}${insert}${content.slice(to)}`,
      source
    )

  it.each([
    ['appended streaming text', 'const value = 1', 'const value = 10'],
    ['removed stale text', 'hello world', 'hello'],
    ['replaced multiple regions', 'abc-123-xyz', 'ABC-123-XYZ']
  ])('reconstructs %s without corrupting content', (_label, oldCode, newCode) => {
    expect(applyChanges(oldCode, prepareCodeChanges(oldCode, newCode))).toBe(newCode)
  })

  it('returns no dispatch changes for identical content', () => {
    expect(prepareCodeChanges('unchanged', 'unchanged')).toEqual([])
  })
})
