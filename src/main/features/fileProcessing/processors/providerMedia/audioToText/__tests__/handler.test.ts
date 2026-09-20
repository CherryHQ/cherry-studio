import { describe, expect, it, vi } from 'vitest'

import { FILE_TYPE, FileInfoSchema } from '@shared/types/file'

vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() }) }
}))

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn()
}))

vi.mock('@cherrystudio/ai-core', () => ({
  generateText: vi.fn()
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: { getByKey: vi.fn() }
}))

vi.mock('@data/services/ProviderService', () => ({
  providerService: { getByProviderId: vi.fn() }
}))

vi.mock('@main/ai/provider/endpoint', () => ({
  resolveEffectiveEndpoint: vi.fn()
}))

vi.mock('@main/ai/provider/sdkConfig', () => ({
  resolveSdkConfig: vi.fn()
}))

import { providerMediaAudioToTextHandler } from '../handler'

const audioFile = FileInfoSchema.parse({
  path: '/tmp/talk.mp3',
  name: 'talk',
  size: 2048,
  ext: 'mp3',
  mime: 'audio/mpeg',
  type: FILE_TYPE.AUDIO,
  createdAt: 1,
  modifiedAt: 1
})

describe('providerMediaAudioToTextHandler', () => {
  it('rejects when no transcription model is configured', () => {
    expect(() =>
      providerMediaAudioToTextHandler.prepare(audioFile, {
        id: 'provider-media',
        type: 'builtin',
        capabilities: [
          {
            feature: 'audio_to_text',
            inputs: ['audio', 'video'],
            output: 'text'
          }
        ]
      })
    ).toThrow(/No transcription model is configured/)
  })
})
