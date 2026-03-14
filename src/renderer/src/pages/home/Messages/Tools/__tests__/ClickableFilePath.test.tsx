import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ClickableFilePath } from '../MessageAgentTools/ClickableFilePath'

const mockOpenPath = vi.fn().mockResolvedValue(undefined)
const mockShowInFolder = vi.fn().mockResolvedValue(undefined)

vi.stubGlobal('api', {
  file: {
    openPath: mockOpenPath,
    showInFolder: mockShowInFolder,
    read: vi.fn(),
    writeWithId: vi.fn()
  }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'chat.input.tools.open_file': 'Open File',
        'chat.input.tools.reveal_in_finder': 'Reveal in Finder'
      }
      return map[key] ?? key
    }
  })
}))

vi.mock('@renderer/hooks/useExternalApps', () => ({
  useExternalApps: () => ({
    data: [
      { id: 'vscode', name: 'Visual Studio Code', protocol: 'vscode://', tags: ['code-editor'], path: '/app/vscode' },
      { id: 'cursor', name: 'Cursor', protocol: 'cursor://', tags: ['code-editor'], path: '/app/cursor' }
    ]
  })
}))

vi.mock('@renderer/utils/editorUtils', () => ({
  getEditorIcon: ({ id }: { id: string }) => <span data-testid={`${id}-icon`} />,
  buildEditorUrl: (app: { protocol: string }, path: string) =>
    `${app.protocol}file/${path.split('/').map(encodeURIComponent).join('/')}?windowId=_blank`
}))

describe('ClickableFilePath', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should render the path as text', () => {
    render(<ClickableFilePath path="/Users/foo/bar.tsx" />)
    expect(screen.getByText('/Users/foo/bar.tsx')).toBeInTheDocument()
  })

  it('should render displayName when provided', () => {
    render(<ClickableFilePath path="/Users/foo/bar.tsx" displayName="bar.tsx" />)
    expect(screen.getByText('bar.tsx')).toBeInTheDocument()
    expect(screen.queryByText('/Users/foo/bar.tsx')).not.toBeInTheDocument()
  })

  it('should call openPath on click', () => {
    render(<ClickableFilePath path="/Users/foo/bar.tsx" />)
    fireEvent.click(screen.getByText('/Users/foo/bar.tsx'))
    expect(mockOpenPath).toHaveBeenCalledWith('/Users/foo/bar.tsx')
  })

  it('should have clickable styling', () => {
    render(<ClickableFilePath path="/tmp/test.ts" />)
    const span = screen.getByText('/tmp/test.ts')
    expect(span).toHaveClass('cursor-pointer')
    expect(span).toHaveStyle({ color: 'var(--color-link)' })
  })

  it('should render ellipsis dropdown trigger', () => {
    render(<ClickableFilePath path="/tmp/test.ts" />)
    expect(document.querySelector('.anticon-ellipsis')).toBeInTheDocument()
  })

  it('should have role="link" and tabIndex for keyboard accessibility', () => {
    render(<ClickableFilePath path="/tmp/test.ts" />)
    const span = screen.getByText('/tmp/test.ts')
    expect(span).toHaveAttribute('role', 'link')
    expect(span).toHaveAttribute('tabindex', '0')
  })

  it('should call openPath on Enter key', () => {
    render(<ClickableFilePath path="/Users/foo/bar.tsx" />)
    fireEvent.keyDown(screen.getByText('/Users/foo/bar.tsx'), { key: 'Enter' })
    expect(mockOpenPath).toHaveBeenCalledWith('/Users/foo/bar.tsx')
  })

  it('should call openPath on Space key', () => {
    render(<ClickableFilePath path="/Users/foo/bar.tsx" />)
    fireEvent.keyDown(screen.getByText('/Users/foo/bar.tsx'), { key: ' ' })
    expect(mockOpenPath).toHaveBeenCalledWith('/Users/foo/bar.tsx')
  })
})
