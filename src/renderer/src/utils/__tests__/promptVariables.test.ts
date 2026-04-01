import { describe, expect, it } from 'vitest'

import {
  extractVariableKeys,
  findOrphanedVariableKeys,
  generateDefaultKey,
  generateVariableId,
  hasTemplateVariables,
  removeVariableFromContent,
  renameVariableInContent,
  replaceTemplateVariables
} from '../promptVariables'

describe('extractVariableKeys', () => {
  it('extracts keys from content', () => {
    expect(extractVariableKeys('Hello ${name}, welcome to ${place}')).toEqual(['name', 'place'])
  })

  it('deduplicates keys', () => {
    expect(extractVariableKeys('${a} and ${a} and ${b}')).toEqual(['a', 'b'])
  })

  it('returns empty array for no variables', () => {
    expect(extractVariableKeys('Hello world')).toEqual([])
  })

  it('handles adjacent variables', () => {
    expect(extractVariableKeys('${a}${b}')).toEqual(['a', 'b'])
  })
})

describe('hasTemplateVariables', () => {
  it('returns true when variables present', () => {
    expect(hasTemplateVariables('Hello ${name}')).toBe(true)
  })

  it('returns false when no variables', () => {
    expect(hasTemplateVariables('Hello world')).toBe(false)
  })
})

describe('replaceTemplateVariables', () => {
  it('replaces all matching variables', () => {
    expect(replaceTemplateVariables('${a} to ${b}', { a: 'Hello', b: 'World' })).toBe('Hello to World')
  })

  it('leaves unmatched variables as-is', () => {
    expect(replaceTemplateVariables('${a} ${b}', { a: 'Hi' })).toBe('Hi ${b}')
  })

  it('replaces duplicate occurrences', () => {
    expect(replaceTemplateVariables('${x} and ${x}', { x: 'ok' })).toBe('ok and ok')
  })

  it('returns original content when no variables', () => {
    expect(replaceTemplateVariables('plain text', {})).toBe('plain text')
  })
})

describe('renameVariableInContent', () => {
  it('renames all occurrences of a variable', () => {
    expect(renameVariableInContent('${from} to ${to}, from ${from}', 'from', 'source')).toBe(
      '${source} to ${to}, from ${source}'
    )
  })

  it('does not affect other variables', () => {
    expect(renameVariableInContent('${a} ${ab}', 'a', 'x')).toBe('${x} ${ab}')
  })
})

describe('removeVariableFromContent', () => {
  it('removes all occurrences', () => {
    expect(removeVariableFromContent('Hello ${name}, dear ${name}', 'name')).toBe('Hello , dear ')
  })

  it('does not affect other variables', () => {
    expect(removeVariableFromContent('${a} ${b}', 'a')).toBe(' ${b}')
  })
})

describe('generateVariableId', () => {
  it('generates non-empty string ids', () => {
    const id = generateVariableId()
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
  })
})

describe('generateDefaultKey', () => {
  it('generates var1 when no existing keys', () => {
    expect(generateDefaultKey([])).toBe('var1')
  })

  it('increments to avoid conflicts', () => {
    expect(generateDefaultKey(['var1'])).toBe('var2')
    expect(generateDefaultKey(['var1', 'var2'])).toBe('var3')
  })

  it('fills gaps', () => {
    expect(generateDefaultKey(['var2', 'var3'])).toBe('var1')
  })
})

describe('findOrphanedVariableKeys', () => {
  it('returns keys not in content', () => {
    const vars = [
      { id: 'v_1', key: 'a', type: 'input' as const },
      { id: 'v_2', key: 'b', type: 'input' as const }
    ]
    expect(findOrphanedVariableKeys('Hello ${a}', vars)).toEqual(['b'])
  })

  it('returns empty when all keys match', () => {
    const vars = [{ id: 'v_1', key: 'name', type: 'input' as const }]
    expect(findOrphanedVariableKeys('${name}', vars)).toEqual([])
  })

  it('returns all keys when content has no variables', () => {
    const vars = [{ id: 'v_1', key: 'x', type: 'input' as const }]
    expect(findOrphanedVariableKeys('plain text', vars)).toEqual(['x'])
  })
})
