import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { FilePreviewNavigationProvider } from '@renderer/components/FilePreview'
import type { AbsoluteFilePath } from '@shared/types/file'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MarkdownFilePreview from '../MarkdownFilePreview'

const mocks = vi.hoisted(() => ({
  codeBlockView: vi.fn(),
  readText: vi.fn()
}))

// This regression depends on Streamdown invoking the supplied anchor renderer;
// opt into the real shared Markdown component instead of the renderer-wide stand-in.
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('@renderer/components/CodeBlockView/CodeBlockView', () => ({
  CodeBlockView: (props: { children: string; language: string; showToolbar?: boolean }) => {
    mocks.codeBlockView(props)
    return (
      <pre data-testid="cherry-code-block" data-language={props.language} data-show-toolbar={String(props.showToolbar)}>
        {props.children}
      </pre>
    )
  }
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

const filePath = '/tmp/workspace/docs/DESIGN.md' as AbsoluteFilePath
const workspacePath = '/tmp/workspace' as AbsoluteFilePath

function renderArtifactPreview(openFile: (path: AbsoluteFilePath) => void) {
  return render(
    <FilePreviewNavigationProvider openFile={openFile} workspacePath={workspacePath}>
      <MarkdownFilePreview
        filePath={filePath}
        fileName="DESIGN.md"
        metadata={{ size: 128 }}
        refreshKey={0}
        type="artifact"
      />
    </FilePreviewNavigationProvider>
  )
}

describe('MarkdownFilePreview links', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        fs: { readText: mocks.readText }
      }
    })
  })

  it('opens a relative Markdown link from the workspace root through the host', async () => {
    mocks.readText.mockResolvedValue('[Design token system](./packages/ui/docs/design-token-system.md)')
    const openFile = vi.fn()
    const user = userEvent.setup()

    renderArtifactPreview(openFile)

    const link = await screen.findByRole('link', { name: 'Design token system' })
    expect(link).toHaveAttribute('href', './packages/ui/docs/design-token-system.md')

    await user.click(link)

    expect(openFile).toHaveBeenCalledWith('/tmp/workspace/packages/ui/docs/design-token-system.md')
    expect(screen.queryByText('Open external link?')).not.toBeInTheDocument()
  })

  it('opens a Windows drive-form Markdown link through the host', async () => {
    mocks.readText.mockResolvedValue('[README](C:/Users/Alice/README.md)')
    const openFile = vi.fn()
    const user = userEvent.setup()

    renderArtifactPreview(openFile)
    await user.click(await screen.findByRole('link', { name: 'README' }))

    expect(openFile).toHaveBeenCalledWith('C:\\Users\\Alice\\README.md')
  })

  it('keeps external links out of the local file opener', async () => {
    mocks.readText.mockResolvedValue('[Cherry Studio](https://cherry-ai.com)')
    const openFile = vi.fn()

    renderArtifactPreview(openFile)

    const link = await screen.findByRole('link', { name: 'Cherry Studio' })
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
    expect(openFile).not.toHaveBeenCalled()
  })

  it('renders fenced source without chat execution or HTML artifact controls', async () => {
    mocks.readText.mockResolvedValue(
      '```tsx\n<Button />\n```\n\n```html\n<button>Run</button>\n```\n\n| Token | Role |\n| --- | --- |\n| link | clickable text |'
    )

    renderArtifactPreview(vi.fn())

    const codeBlocks = await screen.findAllByTestId('cherry-code-block')
    expect(codeBlocks.map((block) => block.getAttribute('data-language'))).toEqual(['tsx', 'html'])
    expect(codeBlocks.every((block) => block.getAttribute('data-show-toolbar') === 'false')).toBe(true)
    expect(screen.getByRole('table').closest('.table-wrapper')).not.toBeNull()
  })
})
