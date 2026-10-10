import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import * as voice from '../index'

function productionSources(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name)
    if (entry.isDirectory()) return entry.name === '__tests__' ? [] : productionSources(absolute)
    return /\.tsx?$/.test(entry.name) ? [absolute] : []
  })
}

describe('voice service public boundary', () => {
  it('exports singleton capabilities without exposing constructable service classes', () => {
    expect(voice.voiceService).toBeDefined()
    expect(voice.voiceTargetManager).toBeDefined()
    expect(voice.dictationService).toBeDefined()
    expect(voice.speechPlaybackService).toBeDefined()
    expect(voice.autoReadCoordinator).toBeDefined()
    expect(voice.readMessageAloud).toBeTypeOf('function')
    expect(voice.planReadableText).toBeTypeOf('function')
    expect(voice.chunkReadableText).toBeTypeOf('function')
    expect('VoiceService' in voice).toBe(false)
    expect('VoiceTargetManager' in voice).toBe(false)
    expect('DictationService' in voice).toBe(false)
    expect('SpeechPlaybackService' in voice).toBe(false)
  })

  it('keeps direct production Voice IPC route calls inside VoiceService', () => {
    const rendererRoot = path.join(process.cwd(), 'src/renderer')
    const directVoiceRequest =
      /\.request\(\s*['"](?:file\.voice_recording\.create|ai\.(?:voice|speech|transcription)\.)/
    const callers = productionSources(rendererRoot)
      .filter((file) => directVoiceRequest.test(readFileSync(file, 'utf8')))
      .map((file) => path.relative(rendererRoot, file))

    expect(callers).toEqual(['services/voice/VoiceService.ts'])
  })
})
