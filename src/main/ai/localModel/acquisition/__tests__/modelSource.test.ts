import { describe, expect, it } from 'vitest'

import { defaultModelSourceId, modelSourceOrder, resolveModelFileUrl } from '../modelSource'

describe('modelSource', () => {
  it('maps the source preference to the expected default', () => {
    expect(defaultModelSourceId('china-first')).toBe('modelscope')
    expect(defaultModelSourceId('global-first')).toBe('huggingface')
  })

  it('orders every mirror with the region default first', () => {
    expect(modelSourceOrder('china-first')).toEqual(['modelscope', 'hf-mirror', 'huggingface'])
    expect(modelSourceOrder('global-first')).toEqual(['huggingface', 'hf-mirror', 'modelscope'])
  })

  it('addresses hf-mirror exactly like HuggingFace, which is what lets one digest cover both', () => {
    const path = 'csukuangfj/sherpa-onnx-funasr-nano-int8-2025-12-30'
    expect(resolveModelFileUrl('hf-mirror', path, 'llm.int8.onnx')).toBe(
      `https://hf-mirror.com/${path}/resolve/main/llm.int8.onnx`
    )
    expect(resolveModelFileUrl('hf-mirror', path, 'llm.int8.onnx').replace('hf-mirror.com', 'huggingface.co')).toBe(
      resolveModelFileUrl('huggingface', path, 'llm.int8.onnx')
    )
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
