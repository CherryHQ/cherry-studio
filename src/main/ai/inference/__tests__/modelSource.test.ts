import { describe, expect, it } from 'vitest'

import { defaultModelSourceId, getModelSource, modelSourceOrder, resolveModelFileUrl } from '../modelSource'

describe('modelSource', () => {
  it('defaults zh locales to ModelScope, everything else to HuggingFace', () => {
    expect(defaultModelSourceId('zh-CN')).toBe('modelscope')
    expect(defaultModelSourceId('ZH-tw')).toBe('modelscope')
    expect(defaultModelSourceId('en-US')).toBe('huggingface')
    expect(defaultModelSourceId('')).toBe('huggingface')
  })

  it('orders mirrors with the locale default first and the other as fallback', () => {
    expect(modelSourceOrder('zh-CN')).toEqual(['modelscope', 'huggingface'])
    expect(modelSourceOrder('en-US')).toEqual(['huggingface', 'modelscope'])
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

  it('honors an explicit revision override', () => {
    expect(resolveModelFileUrl('huggingface', 'org/repo', 'a.onnx', 'v1.0')).toBe(
      'https://huggingface.co/org/repo/resolve/v1.0/a.onnx'
    )
  })

  it('getModelSource still returns the transformers.js env triple for embedding', () => {
    expect(getModelSource('modelscope')).toEqual({
      remoteHost: 'https://www.modelscope.cn',
      remotePathTemplate: 'models/{model}/resolve/{revision}',
      revision: 'master'
    })
  })
})
