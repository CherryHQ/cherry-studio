import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { PIPER_CADU_TTS_BUNDLE_ID, PIPER_FABER_TTS_BUNDLE_ID } from '@shared/ai/localVoice'

import { piperCaduSpeechDefinition, piperFaberSpeechDefinition } from '../piperTts'
import type { completeSpeechOperation } from '../sdkOperations'

const synthesize = vi.fn()
const refreshStatus = vi.fn()
let directory: string
const wav = Buffer.from('UklGRiYAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQIAAAAAAA==', 'base64')

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'piper-tts-adapter-'))
  vi.mocked(application.getPath).mockImplementation((_key, filename) =>
    filename ? join(directory, filename) : directory
  )
  refreshStatus.mockReturnValue({ status: 'ready' })
  vi.mocked(application.get).mockImplementation(((name: string) => {
    if (name === 'TtsInferenceService') return { synthesize }
    if (name === 'LocalModelService') return { refreshStatus }
    throw new Error(`Unexpected service ${name}`)
  }) as never)
})

afterEach(async () => {
  synthesize.mockReset()
  refreshStatus.mockReset()
  vi.restoreAllMocks()
  await rm(directory, { recursive: true, force: true })
})

function speak(definition: typeof piperFaberSpeechDefinition, options: { voice: string; language: string }) {
  const operation = definition.speechOperations[0] as ReturnType<typeof completeSpeechOperation>
  return operation.start({ kind: 'text', text: 'Olá' }, options, undefined as never).output
}

describe.each([
  ['faber', piperFaberSpeechDefinition, PIPER_FABER_TTS_BUNDLE_ID],
  ['cadu', piperCaduSpeechDefinition, PIPER_CADU_TTS_BUNDLE_ID]
])('Piper pt-BR %s speech', (voice, definition, bundleId) => {
  it('lists its single pt-BR voice and defaults to it only for pt-BR', async () => {
    const voices = await definition.voices()
    expect(voices.map((item) => item.id)).toEqual([voice])
    expect(voices[0]).toMatchObject({ locale: 'pt-BR', languages: ['pt-BR'] })
    expect((await definition.getDefaultVoice('pt-BR'))?.id).toBe(voice)
    expect(await definition.getDefaultVoice('zh-CN')).toBeNull()
  })

  it('synthesizes through its own bundle with speaker 0', async () => {
    synthesize.mockImplementation(async (modelId, input) => {
      expect(modelId).toBe(bundleId)
      expect(input).toMatchObject({ text: 'Olá', voice: '0', language: 'pt-BR', speed: 1 })
      await writeFile(input.outputPath, wav)
    })
    const result = await speak(definition, { voice, language: 'pt-BR' })
    expect(result).toMatchObject({ audio: new Uint8Array(wav) })
    expect(await readdir(directory)).toEqual([])
  })

  it('rejects an unknown voice before inference', async () => {
    await expect(speak(definition, { voice: 'missing', language: 'pt-BR' })).rejects.toMatchObject({
      reason: 'invalid_request'
    })
    expect(synthesize).not.toHaveBeenCalled()
  })
})
