import { describe, expect, it } from 'vitest'

import { getModelBundle } from '../../../catalog/catalog'
import { chatModelMemoryFit } from '../memoryFit'

const GB = 1024 ** 3

function fit(id: 'qwen3.5-4b-q4_k_m' | 'qwen3.5-9b-q4_k_m', memoryGb: number) {
  return chatModelMemoryFit(getModelBundle(id).runtime!.chat!, memoryGb * GB)
}

describe('chatModelMemoryFit', () => {
  it('only lets an 8 GB Mac run the 4B model, with a reduced context', () => {
    expect(fit('qwen3.5-4b-q4_k_m', 8)).toBe('runnable')
    expect(fit('qwen3.5-9b-q4_k_m', 8)).toBe('not_recommended')
  })

  it('recommends the 4B model on a 16 GB Mac and lets it run the 9B one', () => {
    expect(fit('qwen3.5-4b-q4_k_m', 16)).toBe('recommended')
    expect(fit('qwen3.5-9b-q4_k_m', 16)).toBe('runnable')
  })

  it('recommends both models from 24 GB up', () => {
    expect(fit('qwen3.5-4b-q4_k_m', 24)).toBe('recommended')
    expect(fit('qwen3.5-9b-q4_k_m', 24)).toBe('recommended')
  })
})
