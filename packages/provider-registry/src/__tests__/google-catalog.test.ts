import { describe, expect, it } from 'vitest'

import { bundledCatalog } from '../bundled-catalog'
import { createRegistry } from '../registry'

describe('Google model catalog', () => {
  it('resolves the official Omni 1.1 Flash id as a video generation model', () => {
    const model = createRegistry(bundledCatalog).findModel('gemini-omni-1.1-flash')

    expect(model).toMatchObject({
      name: 'Gemini Omni 1.1 Flash',
      ownedBy: 'google',
      capabilities: ['image-recognition', 'video-recognition', 'video-generation', 'file-input'],
      contextWindow: 1048576,
      inputModalities: ['text', 'image', 'video'],
      outputModalities: ['video']
    })
  })

  it.each(['gemini-embedding-2', 'gemini-embedding-2-preview'])('resolves %s as a multimodal embedding model', (id) => {
    const registry = createRegistry(bundledCatalog)

    expect(registry.findModel(id)).toMatchObject({
      id,
      ownedBy: 'google',
      capabilities: expect.arrayContaining([
        'embedding',
        'image-recognition',
        'audio-recognition',
        'video-recognition',
        'file-input'
      ]),
      contextWindow: 8192,
      inputModalities: ['text', 'image', 'audio', 'video'],
      outputModalities: ['vector']
    })
  })

  it.each(['gemini-nano-banana-2.1', 'nano-banana-pro-preview'])(
    'resolves the official %s API id with image generation and painting controls',
    (id) => {
      const model = createRegistry(bundledCatalog).findModel(id)

      expect(model).toMatchObject({
        ownedBy: 'google',
        capabilities: expect.arrayContaining(['image-generation', 'image-recognition', 'reasoning']),
        inputModalities: expect.arrayContaining(['text', 'image']),
        outputModalities: ['text', 'image'],
        imageGeneration: {
          modes: {
            generate: {
              supports: {
                aspectRatio: { type: 'enum' },
                imageResolution: { type: 'enum', options: ['1K', '2K', '4K'] }
              }
            }
          }
        },
        reasoning: { wireDialect: 'effort' }
      })
      expect(model?.capabilities).not.toContain('function-call')
      expect(model?.capabilities).not.toContain('structured-output')
    }
  )
})
