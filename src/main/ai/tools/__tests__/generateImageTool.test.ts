import type { ImageGenerationSupport } from '@shared/data/types/model'
import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { buildGenerateImageToolSchema, generateImageInputSchema } from '../generateImageTool'

describe('generate_image input contract', () => {
  it('keeps the fallback schema object-only and prompt-required', () => {
    const json = z.toJSONSchema(generateImageInputSchema) as { required?: unknown }

    expect(Array.isArray(json.required)).toBe(true)
    expect(json.required).toEqual(['prompt'])
    expect(generateImageInputSchema.safeParse({ prompt: 'a cat' }).success).toBe(true)
    expect(generateImageInputSchema.safeParse({ prompt: 'a cat', n: 2 }).success).toBe(false)
  })

  it('derives provider-accurate optional generation params', () => {
    const support = {
      modes: {
        generate: {
          supports: {
            size: { type: 'enum', options: ['1024x1024', '1792x1024'] },
            numImages: { type: 'range', min: 1, max: 3 }
          }
        }
      }
    } satisfies ImageGenerationSupport
    const inputSchema = buildGenerateImageToolSchema(support)
    const json = z.toJSONSchema(inputSchema) as { required?: string[]; properties?: Record<string, unknown> }

    expect(json.required).toEqual(['prompt'])
    expect(json.properties).not.toHaveProperty('image_ids')
    expect(inputSchema.safeParse({ prompt: 'a cat', size: '1792x1024', numImages: 2 }).success).toBe(true)
    expect(inputSchema.safeParse({ prompt: 'a cat', size: '2048x2048' }).success).toBe(false)
  })

  it('limits edit references independently from the maxImages output parameter', () => {
    const support = {
      modes: {
        generate: { supports: { size: { type: 'enum', options: ['1024x1024'] } } },
        edit: {
          supports: {
            maxImages: { type: 'range', min: 1, max: 4 },
            quality: { type: 'enum', options: ['low', 'high'] }
          }
        }
      }
    } satisfies ImageGenerationSupport
    const inputSchema = buildGenerateImageToolSchema(support)

    expect(inputSchema.safeParse({ prompt: 'edit', image_ids: ['f1'], quality: 'high' }).success).toBe(true)
    expect(inputSchema.safeParse({ prompt: 'edit', image_ids: ['f1', 'f2'], quality: 'high' }).success).toBe(false)
  })
})
