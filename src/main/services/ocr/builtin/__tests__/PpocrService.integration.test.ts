/**
 * Integration test for PpocrService async job flow.
 * Requires a real PaddleOCR API endpoint. Skipped by default.
 *
 * Run with:
 *   PADDLEOCR_API_URL=https://paddleocr.aistudio-app.com \
 *   PADDLEOCR_TOKEN=<token> \
 *   TEST_IMAGE=/path/to/image.png \
 *   pnpm test:main --reporter=verbose src/main/services/ocr/builtin/__tests__/PpocrService.integration.test.ts
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  net: { fetch: (url: string, init?: RequestInit) => fetch(url, init) }
}))

vi.mock('form-data', () => {
  const FormDataReal = require('form-data')
  return { default: FormDataReal }
})

const API_URL = process.env.PADDLEOCR_API_URL
const TOKEN = process.env.PADDLEOCR_TOKEN
const IMAGE_PATH = process.env.TEST_IMAGE

const runIntegration = API_URL && TOKEN && IMAGE_PATH

describe.skipIf(!runIntegration)('PpocrService integration', () => {
  it('submits job and returns OCR text', async () => {
    const { ppocrService } = await import('../PpocrService')

    const result = await ppocrService.ocr(
      {
        id: 'test',
        name: 'test-image',
        origin_name: 'test-image',
        path: IMAGE_PATH!,
        size: 0,
        ext: IMAGE_PATH!.split('.').pop() ?? '',
        type: 'image',
        created_at: new Date().toISOString()
      } as any,
      {
        apiUrl: API_URL!,
        accessToken: TOKEN!
      }
    )

    expect(result.text).toBeTruthy()
    expect(typeof result.text).toBe('string')
    console.log('OCR result:', result.text.slice(0, 200))
  }, 60_000)
})
