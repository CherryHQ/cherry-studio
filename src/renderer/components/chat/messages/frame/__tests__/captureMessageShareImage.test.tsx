import { act, within } from '@testing-library/react'
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

it.each([
  { name: 'dollar fences', opening: '$$', closing: '$$', singleDollarMath: true },
  { name: 'LaTeX brackets', opening: '\\[', closing: '\\]', singleDollarMath: false }
])(
  'cleans prose after a formula with $name and preserves real code',
  async ({ opening, closing, singleDollarMath }) => {
    const code = 'Keep [cite:literal] in code.'
    const markdown = [
      [opening, 'x=1', '~~~', closing].join('\n'),
      'Result [cite:stale].',
      '~~~txt\n' + code + '\n~~~'
    ].join('\n\n')
    let captured: { text: string | null; formula: string | null; code: string | undefined } | undefined
    vi.mocked(exportService.captureScrollableAsDataUrl).mockImplementation(async ({ current }) => {
      if (current) {
        captured = {
          text: current.textContent,
          formula: within(current).queryByRole('math', { hidden: true })?.textContent ?? null,
          code: current.querySelector('pre code')?.textContent?.trimEnd()
        }
      }
      return 'data:image/png;base64,AAAA'
    })

    let capture: ReturnType<typeof captureMessageShareImage> | undefined
    await act(async () => {
      capture = captureMessageShareImage(markdown, singleDollarMath, { parts: [] })
    })
    await expect(capture).resolves.toBe('data:image/png;base64,AAAA')
    expect(captured).toEqual({
      text: expect.stringContaining('Result.'),
      formula: expect.stringContaining('x=1'),
      code
    })
    expect(captured?.text).not.toContain('[cite:stale]')
  }
)

it.each([
  {
    name: 'LaTeX verbatim',
    markdown: '\\(\\verb`prefix [cite:literal] suffix`\\)',
    tex: '\\verb`prefix [cite:literal] suffix`',
    singleDollarMath: false
  },
  {
    name: 'display math',
    markdown: '$$\n\\text{Grade [2] [cite:2]}\n$$',
    tex: '\\text{Grade [2] [cite:2]}',
    singleDollarMath: false
  },
  {
    name: 'single-dollar math',
    markdown: '$x_{[2]}$',
    tex: 'x_{[2]}',
    singleDollarMath: true
  }
])('preserves literal text in $name while cleaning adjacent prose', async ({ markdown, tex, singleDollarMath }) => {
  const parts: CherryMessagePart[] = [
    { type: 'source-url', sourceId: 'citation-0', url: 'https://example.test/first', title: 'First source' },
    { type: 'source-url', sourceId: 'citation-1', url: 'https://example.test/second', title: 'Second source' }
  ]
  let capturedTex: string | undefined
  let capturedText: string | null | undefined
  vi.mocked(exportService.captureScrollableAsDataUrl).mockImplementation(async ({ current }) => {
    if (current) {
      const math = within(current).queryByRole('math', { hidden: true })
      capturedTex = math?.querySelector('annotation')?.textContent?.trim()
      capturedText = current.textContent
    }
    return 'data:image/png;base64,AAAA'
  })

  let capture: ReturnType<typeof captureMessageShareImage> | undefined
  await act(async () => {
    capture = captureMessageShareImage(markdown + '\n\nResult [cite:1] [cite:stale].', singleDollarMath, { parts })
  })
  await expect(capture).resolves.toBe('data:image/png;base64,AAAA')
  expect(capturedTex).toBe(tex)
  expect(capturedText).toContain('Result [1].')
  expect(capturedText).not.toContain('[cite:stale]')
})
