import { describe, expect, it } from 'vitest'

import { applyDerivation, dictTextFromInferenceYml } from '../derivations'

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
})

describe('applyDerivation', () => {
  it('routes a declared derivation to its implementation', () => {
    const yml = ['PostProcess:', '  name: CTCLabelDecode', '  character_dict:', '  - a'].join('\n')

    expect(applyDerivation('paddle_dict_from_inference_yml', yml)).toBe('\na\n')
  })
})
