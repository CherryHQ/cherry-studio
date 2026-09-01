import { describe, expect, it } from 'vitest'

import { defaultModelSourceId, modelSourceOrder, resolveModelFileUrl } from '../modelSource'

describe('modelSource', () => {
  it('maps the source preference to the expected default', () => {
    expect(defaultModelSourceId('china-first')).toBe('modelscope')
    expect(defaultModelSourceId('global-first')).toBe('huggingface')
  })

  it('keeps the non-default source as fallback', () => {
    expect(modelSourceOrder('china-first')).toEqual(['modelscope', 'huggingface'])
    expect(modelSourceOrder('global-first')).toEqual(['huggingface', 'modelscope'])
  })

  it('builds HuggingFace file URLs with the {model}/resolve/{revision} route', () => {
    expect(resolveModelFileUrl('huggingface', 'PaddlePaddle/PP-OCRv6_medium_det_onnx', 'inference.onnx')).toBe(
      'https://huggingface.co/PaddlePaddle/PP-OCRv6_medium_det_onnx/resolve/main/inference.onnx'
    )
  })

  it('builds ModelScope file URLs with the models/ prefix and master branch', () => {
    expect(resolveModelFileUrl('modelscope', 'PaddlePaddle/PP-OCRv6_medium_rec_onnx', 'inference.onnx')).toBe(
      'https://www.modelscope.cn/models/PaddlePaddle/PP-OCRv6_medium_rec_onnx/resolve/master/inference.onnx'
    )
  })
})
