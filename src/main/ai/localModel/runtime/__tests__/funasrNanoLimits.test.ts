import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  computeFunAsrNanoChunkSamples,
  parseOnnxMetadataInt,
  readFunAsrNanoLimits
} from '../utilityEntries/funasrNanoLimits'

const metadataEntry = (key: string, value: string) =>
  Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0x12, value.length]), Buffer.from(value, 'latin1')])

const trailingEntry = Buffer.from('r\x13\n\bio_dtype\x12\x07float32', 'latin1')

describe('parseOnnxMetadataInt', () => {
  it('reads the length-prefixed ASCII value that follows the key', () => {
    const tail = Buffer.concat([
      Buffer.from('graph bytes', 'latin1'),
      metadataEntry('max_total_len', '512'),
      trailingEntry
    ])
    expect(parseOnnxMetadataInt(tail, 'max_total_len', { min: 64, max: 131_072 })).toBe(512)
  })

  it('prefers the last valid occurrence when the key repeats', () => {
    const tail = Buffer.concat([
      metadataEntry('max_total_len', '512'),
      metadataEntry('max_total_len', '1024'),
      trailingEntry
    ])
    expect(parseOnnxMetadataInt(tail, 'max_total_len', { min: 64, max: 131_072 })).toBe(1024)
  })

  it('rejects non-digit values, out-of-range values and missing keys', () => {
    const nonDigit = Buffer.concat([metadataEntry('max_total_len', '12ab'), trailingEntry])
    expect(parseOnnxMetadataInt(nonDigit, 'max_total_len', { min: 64, max: 131_072 })).toBeUndefined()
    const outOfRange = Buffer.concat([metadataEntry('max_total_len', '8'), trailingEntry])
    expect(parseOnnxMetadataInt(outOfRange, 'max_total_len', { min: 64, max: 131_072 })).toBeUndefined()
    expect(parseOnnxMetadataInt(trailingEntry, 'max_total_len', { min: 64, max: 131_072 })).toBeUndefined()
  })
})

describe('readFunAsrNanoLimits', () => {
  let appPath: string

  beforeEach(async () => {
    appPath = await mkdtemp(path.join(tmpdir(), 'cherry-funasr-limits-'))
  })

  afterEach(async () => {
    await rm(appPath, { recursive: true, force: true })
  })

  const modelPaths = () => ({
    encoder: path.join(appPath, 'encoder_adaptor.int8.onnx'),
    llm: path.join(appPath, 'llm.int8.onnx')
  })

  it('derives the limits from the model metadata', async () => {
    await writeFile(
      modelPaths().llm,
      Buffer.concat([Buffer.from('graph', 'latin1'), metadataEntry('max_total_len', '1024'), trailingEntry])
    )
    await writeFile(
      modelPaths().encoder,
      Buffer.concat([
        Buffer.from('graph', 'latin1'),
        metadataEntry('lfr_window_size', '7'),
        metadataEntry('lfr_window_shift', '6'),
        trailingEntry
      ])
    )
    await expect(readFunAsrNanoLimits(modelPaths())).resolves.toEqual({
      maxTotalLen: 1024,
      samplesPerAudioToken: 960,
      usedFallback: false
    })
  })

  it('falls back to the documented artifact values when metadata is unreadable', async () => {
    await writeFile(modelPaths().llm, Buffer.from('graph without metadata', 'latin1'))
    await writeFile(modelPaths().encoder, Buffer.from('graph without metadata', 'latin1'))
    await expect(readFunAsrNanoLimits(modelPaths())).resolves.toEqual({
      maxTotalLen: 512,
      samplesPerAudioToken: 960,
      usedFallback: true
    })
  })

  it('falls back without throwing when the files are missing', async () => {
    await expect(readFunAsrNanoLimits(modelPaths())).resolves.toEqual({
      maxTotalLen: 512,
      samplesPerAudioToken: 960,
      usedFallback: true
    })
  })
})

describe('computeFunAsrNanoChunkSamples', () => {
  it('reserves output tokens from the KV window', () => {
    expect(computeFunAsrNanoChunkSamples({ maxTotalLen: 512, samplesPerAudioToken: 960, usedFallback: false })).toBe(
      224 * 960
    )
    expect(computeFunAsrNanoChunkSamples({ maxTotalLen: 4096, samplesPerAudioToken: 960, usedFallback: false })).toBe(
      3808 * 960
    )
  })

  it('stays positive for degenerate windows', () => {
    expect(computeFunAsrNanoChunkSamples({ maxTotalLen: 100, samplesPerAudioToken: 960, usedFallback: true })).toBe(
      8 * 960
    )
  })
})
