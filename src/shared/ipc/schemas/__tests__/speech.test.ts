import { describe, expect, it } from 'vitest'

import { speechRequestSchemas } from '../speech'

describe('speech IPC schemas', () => {
  const evaluate = speechRequestSchemas['speech.evaluate'].input

  it('accepts recorded audio metadata with composed speaking evaluation', () => {
    expect(
      evaluate.safeParse({
        sessionId: 'session-1',
        mode: 'shadowing',
        target: 'Could you say that again?',
        meaning: '你能再说一遍吗？',
        cefr: 'B2',
        taskInstruction: 'Shadow the sentence, then paraphrase it in a nearby real-life context.',
        transcript: 'Could you say that again',
        audioBase64: 'UklGRg==',
        mediaType: 'audio/wav'
      }).success
    ).toBe(true)
  })

  it('rejects empty recorded audio payloads', () => {
    expect(
      evaluate.safeParse({
        sessionId: 'session-1',
        mode: 'shadowing',
        target: 'Could you say that again?',
        transcript: 'Could you say that again',
        audioBase64: '',
        mediaType: 'audio/wav'
      }).success
    ).toBe(false)
  })
})
