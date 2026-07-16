// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { FilePath } from '@shared/types/file'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  wordPreviewPanel: vi.fn()
}))

vi.mock('@renderer/components/ArtifactPreview/office/WordPreviewPanel', () => ({
  default: (props: unknown) => {
    mocks.wordPreviewPanel(props)
    return <div data-testid="word-preview-panel" />
  }
}))

import WordFilePreview from '../WordFilePreview'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WordFilePreview', () => {
  it('delegates the normalized preview props to the Word panel', () => {
    const filePath = '/tmp/documents/report.docx' as FilePath

    render(<WordFilePreview filePath={filePath} fileName="report.docx" refreshKey={3} />)

    expect(screen.getByTestId('word-preview-panel')).toBeInTheDocument()
    expect(mocks.wordPreviewPanel).toHaveBeenCalledWith({
      filePath,
      fileName: 'report.docx',
      refreshKey: 3
    })
  })
})
