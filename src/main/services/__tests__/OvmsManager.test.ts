import { describe, expect, it } from 'vitest'

import { validateOvmsDownloadInput } from '../OvmsManager'

describe('validateOvmsDownloadInput', () => {
  it('accepts expected OVMS download inputs', () => {
    expect(
      validateOvmsDownloadInput(
        'Qwen2.5-0.5B-Instruct',
        'OpenVINO/Qwen2.5-0.5B-Instruct-int4-ov',
        'https://www.modelscope.cn/models',
        'text_generation'
      )
    ).toEqual({
      modelName: 'Qwen2.5-0.5B-Instruct',
      modelId: 'OpenVINO/Qwen2.5-0.5B-Instruct-int4-ov',
      modelSource: 'https://www.modelscope.cn/models',
      task: 'text_generation'
    })
  })

  it('rejects suspicious model identifiers and names', () => {
    expect(() =>
      validateOvmsDownloadInput(
        'bad name',
        'OpenVINO/../../evil',
        'https://www.modelscope.cn/models',
        'text_generation'
      )
    ).toThrow()

    expect(() =>
      validateOvmsDownloadInput(
        'model"; calc.exe; "',
        'OpenVINO/model',
        'https://www.modelscope.cn/models',
        'text_generation'
      )
    ).toThrow('Invalid model name')
  })

  it('rejects unexpected download sources and tasks', () => {
    expect(() =>
      validateOvmsDownloadInput('model', 'OpenVINO/model', 'https://evil.example', 'text_generation')
    ).toThrow('Invalid model source')

    expect(() =>
      validateOvmsDownloadInput('model', 'OpenVINO/model', 'https://www.modelscope.cn/models', 'shell')
    ).toThrow('Invalid model task')
  })
})
