import { describe, expect, it } from 'vitest'

import { parseIllustrationIntent } from '../illustrationIntent'

describe('illustration reference protocol', () => {
  it('separates ordered reference selection from the image prompt and accepts text-only blocks', () => {
    expect(
      parseIllustrationIntent('references: ["image_2", "image_1", "image_2"]\nPut the person in the scene.')
    ).toEqual({
      prompt: 'Put the person in the scene.',
      references: ['image_2', 'image_1']
    })
    expect(parseIllustrationIntent('  A red bird  ')).toEqual({ prompt: 'A red bird', references: [] })
    expect(parseIllustrationIntent('references: []\nA red bird')).toEqual({ prompt: 'A red bird', references: [] })
  })

  it('preserves legacy text prompts that begin with the word references without a reference field', () => {
    const prompt = 'References to Art Nouveau in a botanical poster.'
    expect(parseIllustrationIntent(prompt)).toEqual({ prompt, references: [] })
  })
})
