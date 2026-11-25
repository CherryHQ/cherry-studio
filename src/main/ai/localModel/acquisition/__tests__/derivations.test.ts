import { describe, expect, it } from 'vitest'

import { dictTextFromInferenceYml } from '../derivations'

describe('dictTextFromInferenceYml', () => {
  it('reproduces PaddleOCR dict format: leading blank slot, entries, trailing space slot', () => {
    const yml = ['PostProcess:', '  name: CTCLabelDecode', '  character_dict:', "  - '!'", '  - a', '  - 你'].join('\n')

    const text = dictTextFromInferenceYml(yml)

    expect(text).toBe('\n!\na\n你\n')
    // ppu-paddle-ocr parses the dict with split(/\r?\n/) and no trimming: index 0
    // must be the blank token and the final entry the space class.
    const entries = text.split(/\r?\n/)
    expect(entries[0]).toBe('')
    expect(entries.at(-1)).toBe('')
    expect(entries.slice(1, -1)).toEqual(['!', 'a', '你'])
  })

  it('throws when the yml has no PostProcess.character_dict', () => {
    expect(() => dictTextFromInferenceYml('PostProcess:\n  name: CTCLabelDecode\n')).toThrow('character_dict')
  })

  it('preserves numeric and null dictionary entries and their decoder positions', () => {
    const yml = 'PostProcess:\n  character_dict:\n    - 7\n    - null\n    - false\n'
    expect(dictTextFromInferenceYml(yml)).toBe('\n7\nnull\nfalse\n')
  })

  it('rejects an empty dictionary instead of emitting only the two reserved slots', () => {
    expect(() => dictTextFromInferenceYml('PostProcess:\n  character_dict: []\n')).toThrow('character_dict')
  })
})
