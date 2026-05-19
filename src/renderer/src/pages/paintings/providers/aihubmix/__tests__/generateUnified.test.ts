import { afterEach, describe, expect, it, vi } from 'vitest'

const generatePaintingImageMock = vi.fn()

vi.mock('@renderer/aiCore', () => ({
  AiProvider: vi.fn().mockImplementation(() => ({ generatePaintingImage: generatePaintingImageMock }))
}))

vi.mock('../../../utils/checkProviderEnabled', () => ({
  checkProviderEnabled: vi.fn(async () => 'sk-test')
}))

vi.mock('../../../model/paintingGenerationService', () => ({
  runPainting: vi.fn(async (fn: () => Promise<unknown>) => fn())
}))

vi.mock('../imageUpload', () => ({
  getAihubmixUploadedFile: vi.fn()
}))

vi.mock('i18next', () => ({ default: { t: (k: string) => k } }))
vi.mock('@renderer/i18n', () => ({ default: { t: (k: string) => k } }))

import { generateWithAihubmixUnified } from '../generateUnified'

/**
 * Locks the bespoke `generate.ts` parity that the unified adapter must keep
 * before the bespoke path is deleted: imagen-* drives `imageSize` from the
 * aspect ratio (and imagen-4.0-ultra is single-image), and FLUX.1-Kontext-pro
 * defaults `safety_tolerance` to 6 when the user leaves it unset.
 */
describe('generateWithAihubmixUnified param parity', () => {
  afterEach(() => {
    generatePaintingImageMock.mockReset()
  })

  const run = async (painting: Record<string, unknown>, tab = 'generate') => {
    generatePaintingImageMock.mockResolvedValue([{ type: 'base64', base64: 'AAA' }])
    await generateWithAihubmixUnified({
      painting: { prompt: 'a fox', ...painting } as never,
      provider: { id: 'aihubmix', name: 'AiHubMix', apiHost: 'https://aihubmix.com', isEnabled: true } as never,
      tab,
      abortController: new AbortController()
    } as never)
    return generatePaintingImageMock.mock.calls[0][0] as {
      model: string
      imageSize: string
      batchSize: number
      providerOptions: { aihubmix: Record<string, unknown> }
    }
  }

  it('imagen-4.0-ultra → aspect-ratio imageSize and single image', async () => {
    const args = await run({
      model: 'imagen-4.0-ultra-generate-preview-06-06',
      aspectRatio: 'ASPECT_16_9',
      numberOfImages: 4
    })
    expect(args.imageSize).toBe('16:9')
    expect(args.batchSize).toBe(1)
  })

  it('imagen-4.0 (non-ultra) → aspect-ratio imageSize and numberOfImages batch', async () => {
    const args = await run({
      model: 'imagen-4.0-generate-preview-06-06',
      aspectRatio: 'ASPECT_3_4',
      numberOfImages: 3
    })
    expect(args.imageSize).toBe('3:4')
    expect(args.batchSize).toBe(3)
  })

  it('imagen-* without aspectRatio defaults to 1:1', async () => {
    const args = await run({ model: 'imagen-4.0-generate-preview-06-06' })
    expect(args.imageSize).toBe('1:1')
    expect(args.batchSize).toBe(1)
  })

  it('FLUX.1-Kontext-pro defaults safety_tolerance to 6 when unset', async () => {
    const args = await run({ model: 'FLUX.1-Kontext-pro', numImages: 2 })
    expect(args.providerOptions.aihubmix.safety_tolerance).toBe(6)
    expect(args.imageSize).toBe('1024x1024')
    expect(args.batchSize).toBe(2)
  })

  it('FLUX.1-Kontext-pro keeps an explicit safety_tolerance', async () => {
    const args = await run({ model: 'FLUX.1-Kontext-pro', safetyTolerance: 2 })
    expect(args.providerOptions.aihubmix.safety_tolerance).toBe(2)
  })

  it('gpt-image-1 keeps pixel size and does not inject a safety_tolerance default', async () => {
    const args = await run({ model: 'gpt-image-1', size: '1536x1024', numImages: 1 })
    expect(args.imageSize).toBe('1536x1024')
    expect(args.batchSize).toBe(1)
    expect(args.providerOptions.aihubmix.safety_tolerance).toBeUndefined()
  })

  // R1: URL results (Ideogram) go back to the main-process downloader with
  // the proxy hint; base64 results (gpt-image) take the base64 branch.
  const runResult = async (painting: Record<string, unknown>, classified: unknown[]) => {
    generatePaintingImageMock.mockResolvedValue(classified)
    return generateWithAihubmixUnified({
      painting: { prompt: 'a fox', ...painting } as never,
      provider: { id: 'aihubmix', name: 'AiHubMix', apiHost: 'https://aihubmix.com', isEnabled: true } as never,
      tab: 'generate',
      abortController: new AbortController()
    } as never)
  }

  it('returns { urls, downloadOptions.showProxyWarning } for URL outputs', async () => {
    const result = await runResult({ model: 'V_3' }, [{ type: 'url', url: 'https://img/a.png' }])
    expect(result).toEqual({ urls: ['https://img/a.png'], downloadOptions: { showProxyWarning: true } })
  })

  it('returns { base64s } for base64 outputs', async () => {
    const result = await runResult({ model: 'gpt-image-1' }, [{ type: 'base64', base64: 'QUJD' }])
    expect(result).toEqual({ base64s: ['QUJD'] })
  })
})
