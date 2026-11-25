import { act } from '@testing-library/react'
import { expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { exportService } from '@renderer/services/ExportService'
import type { CherryMessagePart } from '@shared/data/types/message'

import { captureMessageShareImage } from '../captureMessageShareImage'

vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())
vi.mock('@renderer/services/ExportService', () => ({
  exportService: { captureScrollableAsDataUrl: vi.fn() }
}))

it('renders citation numbers, drops stale markers, and preserves markers inside code', async () => {
  const parts: CherryMessagePart[] = [
    { type: 'source-url', sourceId: 'citation-0', url: 'https://example.com/source', title: 'Example source' }
  ]
  const markdown = [
    'Grounded claim [cite:1].',
    'Another claim [cite:retired-9].',
    'Inline example: `[cite:inline-code]`.',
    '```txt\n[cite:fenced-code]\n```',
    '~~~txt\nTilde prefix [cite:literal] suffix\n~~~',
    '    Indented prefix [cite:1] and [2] suffix',
    '> ~~~~txt\n> Quoted prefix [cite:retired-9] suffix\n> ~~~~',
    'Final claim [cite:retired-10].'
  ].join('\n\n')
  let capturedText: string | null | undefined
  let capturedCode: Array<string | undefined> = []
  vi.mocked(exportService.captureScrollableAsDataUrl).mockImplementation(async ({ current }) => {
    capturedText = current?.textContent
    capturedCode = current
      ? Array.from(current.querySelectorAll('pre code'), (code) => code.textContent?.trimEnd())
      : []
    return 'data:image/png;base64,AAAA'
  })

  let capture: ReturnType<typeof captureMessageShareImage> | undefined
  await act(async () => {
    capture = captureMessageShareImage(markdown, true, { parts })
  })
  await expect(capture).resolves.toBe('data:image/png;base64,AAAA')
  expect(capturedText).toContain('Grounded claim [1].')
  expect(capturedText).toContain('Another claim.')
  expect(capturedText).toContain('Final claim.')
  expect(capturedText).not.toContain('[cite:retired-10]')
  expect(capturedText).toContain('[cite:inline-code]')
  expect(capturedCode).toEqual([
    '[cite:fenced-code]',
    'Tilde prefix [cite:literal] suffix',
    'Indented prefix [cite:1] and [2] suffix',
    'Quoted prefix [cite:retired-9] suffix'
  ])
})
