import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'
import * as z from 'zod'

import { resolveImageGenerationSupport } from '@cherrystudio/provider-registry'
import { readModelRegistry, readProviderModelRegistry } from '@cherrystudio/provider-registry/node'

import { buildGenerateImageToolSchema, generateImageInputSchema } from '../generateImageTool'

describe('generate_image input contract', () => {
  it('keeps the unconfigured tool prompt-required and rejects undeclared parameters', () => {
    expect(generateImageInputSchema.safeParse({ prompt: 'a cat' }).success).toBe(true)
    expect(generateImageInputSchema.safeParse({ prompt: '', n: 2 }).success).toBe(false)
    expect(z.toJSONSchema(generateImageInputSchema).type).toBe('object')
  })

  // https://cloud.tencent.com/document/product/1823/135745 (retrieved 2026-09-09).
  it('exposes optional references on ordinary TokenHub generation and enforces its input limit', () => {
    const registry = readProviderModelRegistry(
      resolve(process.cwd(), 'packages/provider-registry/data/provider-models.json')
    )
    const row = registry.overrides.find(
      (entry) => entry.providerId === 'tokenhub' && entry.apiModelId === 'hy-image-v3'
    )
    if (!row?.imageGeneration) throw new Error('TokenHub producer fixture missing')
    const models = readModelRegistry(resolve(process.cwd(), 'packages/provider-registry/data/models.json'))
    const base = models.models.find((model) => model.id === row.modelId)
    const support = resolveImageGenerationSupport(base ?? null, row)
    const schema = buildGenerateImageToolSchema(support)
    expect(schema.safeParse({ prompt: 'a cat' }).success).toBe(true)
    expect(schema.safeParse({ prompt: 'a cat', image_ids: ['one', 'two', 'three'] }).success).toBe(true)
    expect(schema.safeParse({ prompt: 'a cat', image_ids: ['one', 'two', 'three', 'four'] }).success).toBe(false)
  })

  it('does not union input-specific parameters into the ordinary tool subset', () => {
    const schema = buildGenerateImageToolSchema({
      supports: {
        seed: {
          type: 'range',
          min: 0,
          max: 10
        },
        size: {
          type: 'text'
        }
      },
      inputs: {
        images: {
          min: 0,
          max: {
            kind: 'unknown'
          }
        },
        prompt: 'required',
        mask: 'unknown',
        mediaTypes: {
          kind: 'unknown'
        }
      },
      withImages: {
        supports: {
          strength: {
            type: 'range',
            min: 0,
            max: 1
          },
          size: null
        }
      }
    })
    expect(schema.safeParse({ prompt: 'edit', image_ids: ['f1'], seed: 0 }).success).toBe(true)
    expect(schema.safeParse({ prompt: 'edit', image_ids: ['f1'], size: '1024x1024' }).success).toBe(false)
    expect(schema.safeParse({ prompt: 'draw', strength: 0.5 }).success).toBe(false)
  })

  it('requires images and permits an empty prompt only when the capability declares it', () => {
    const schema = buildGenerateImageToolSchema({
      supports: {},
      inputs: {
        images: {
          min: 1,
          max: {
            kind: 'known',
            value: 1
          }
        },
        prompt: 'optional',
        mask: 'unknown',
        mediaTypes: {
          kind: 'unknown'
        }
      }
    })
    expect(schema.safeParse({ prompt: '', image_ids: ['f1'] }).success).toBe(true)
    expect(schema.safeParse({ prompt: '' }).success).toBe(false)
  })
})
