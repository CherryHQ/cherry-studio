// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import type { FilePath } from '@shared/types/file'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  pptxPreviewPanel: vi.fn()
}))

vi.mock('@renderer/components/ArtifactPreview/office/PptxPreviewPanel', () => ({
  default: (props: unknown) => {
    mocks.pptxPreviewPanel(props)
    return <div data-testid="powerpoint-preview-panel" />
  }
}))

import PowerPointFilePreview from '../PowerPointFilePreview'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('PowerPointFilePreview', () => {
  it('delegates the normalized preview props to the PowerPoint panel', () => {
    const filePath = '/tmp/presentations/roadmap.pptx' as FilePath

    render(<PowerPointFilePreview filePath={filePath} fileName="roadmap.pptx" refreshKey={4} />)

    expect(screen.getByTestId('powerpoint-preview-panel')).toBeInTheDocument()
    expect(mocks.pptxPreviewPanel).toHaveBeenCalledWith({
      filePath,
      fileName: 'roadmap.pptx',
      refreshKey: 4
    })
  })
})
