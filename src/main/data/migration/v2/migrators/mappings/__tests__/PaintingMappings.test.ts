import { describe, expect, it } from 'vitest'

import { getPaintingFilter, transformLegacyPaintingRecord } from '../PaintingMappings'

describe('PaintingMappings', () => {
  const legacyParentFieldKey = ['parent', 'Id'].join('')

  it('maps DMXAPI edit and merge records into legacy granular modes', () => {
    expect(getPaintingFilter('dmxapi_paintings', { generationMode: 'edit' })).toEqual({
      providerId: 'dmxapi',
      mode: 'edit'
    })
    expect(getPaintingFilter('dmxapi_paintings', { generationMode: 'merge' })).toEqual({
      providerId: 'dmxapi',
      mode: 'merge'
    })
    expect(getPaintingFilter('dmxapi_paintings', { generationMode: 'generation' })).toEqual({
      providerId: 'dmxapi',
      mode: 'generate'
    })
  })

  it('preserves custom provider ids for openai-compatible records', () => {
    const result = transformLegacyPaintingRecord('openai_image_generate', {
      id: 'painting-1',
      providerId: 'my-custom-new-api',
      prompt: 'hello'
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        providerId: 'my-custom-new-api',
        mode: 'generate',
        mediaType: 'image'
      }
    })
  })

  it('does not carry the legacy parent field into normalized painting rows', () => {
    const result = transformLegacyPaintingRecord('siliconflow_paintings', {
      id: 'painting-parentless',
      [legacyParentFieldKey]: 'legacy-parent',
      prompt: 'hello'
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        mediaType: 'image',
        params: {}
      }
    })
    expect(result.ok && legacyParentFieldKey in result.value).toBe(false)
  })

  it('moves legacy async task ids into params.taskId', () => {
    const tokenFluxResult = transformLegacyPaintingRecord('tokenflux_paintings', {
      id: 'painting-1',
      generationId: 'task-1',
      prompt: 'hello'
    })
    const ppioResult = transformLegacyPaintingRecord('ppio_edit', {
      id: 'painting-2',
      taskId: 'task-2',
      prompt: 'hello'
    })

    expect(tokenFluxResult).toMatchObject({
      ok: true,
      value: {
        params: {
          taskId: 'task-1'
        }
      }
    })
    expect(ppioResult).toMatchObject({
      ok: true,
      value: {
        params: {
          taskId: 'task-2',
          editVariant: 'img2img'
        }
      }
    })
  })

  it('drops non-recoverable in-memory input image references with warnings', () => {
    const result = transformLegacyPaintingRecord('ppio_edit', {
      id: 'painting-3',
      prompt: 'hello',
      imageFile: 'blob:http://example.com/123'
    })

    expect(result).toMatchObject({
      ok: true,
      value: {
        files: { input: [] }
      }
    })
    expect(result.warnings).toContain(
      'Dropped legacy input image reference because only an in-memory string/object URL was available'
    )
  })

  it('skips placeholder records when only transient urls exist', () => {
    const result = transformLegacyPaintingRecord('siliconflow_paintings', {
      id: 'painting-4',
      prompt: '',
      urls: ['https://example.com/a.png']
    })

    expect(result).toMatchObject({
      ok: false,
      reason: 'empty_placeholder'
    })
  })
})
