import { describe, expect, it } from 'vitest'

import { classifyTranslationBlocks } from '../utils/translationBlocks'

const line = (text: string, x: number) => ({ text, box: { x, y: 0, width: 10, height: 10 } })

describe('classifyTranslationBlocks', () => {
  it('keeps target, short, mixed and overlapping lines untouched', () => {
    const lines = [
      line('this is a long sentence', 0),
      line('another long sentence', 5),
      line('tiny', 30),
      line('english mixed 中文文字', 50),
      line('a target language sentence', 70)
    ]
    const result = classifyTranslationBlocks(lines, ['en-us', 'en-us', 'en-us', 'en-us', 'zh-cn'], 'zh-tw', {
      width: 100,
      height: 20
    })
    expect(result.sourceLangCode).toBe('en-us')
    expect(result.blocks.map((block) => block.status)).toEqual(['skipped', 'skipped', 'skipped', 'skipped', 'skipped'])
    expect(result.blocks[0].reason).toBe('overlap')
    expect(result.blocks[3].reason).toBe('mixed_script')
    expect(result.blocks[4].reason).toBe('target_language')
  })
  it('requires a strict weighted majority and clamps physical geometry', () => {
    const lines = [line('abcdefghij', -2), line('abcdefghij', 30)]
    expect(
      classifyTranslationBlocks(lines, ['en-us', 'fr-fr'], 'zh-cn', { width: 100, height: 20 }).sourceLangCode
    ).toBeNull()
    const result = classifyTranslationBlocks([lines[0]], ['en-us'], 'zh-cn', { width: 100, height: 20 })
    expect(result.blocks[0].box).toEqual({ x: 0, y: 0, width: 8, height: 10 })
    expect(result.blocks[0].status).toBe('queued')
  })
})
