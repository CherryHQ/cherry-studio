import '@testing-library/jest-dom/vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'
import { FilePreviewNavigationProvider } from '@renderer/components/FilePreview'
import type { AbsoluteFilePath } from '@shared/types/file'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import MarkdownFilePreview from '../MarkdownFilePreview'

const mocks = vi.hoisted(() => ({
  readText: vi.fn()
}))

// This regression depends on Streamdown invoking the supplied anchor renderer;
// opt into the real shared Markdown component instead of the renderer-wide stand-in.
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal<typeof CherryStudioUi>())

vi.mock('@renderer/components/CodeViewer', () => ({
  default: ({ value }: { value: string }) => <pre aria-label="Code viewer">{value}</pre>
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCmTheme: 'light' })
}))

vi.mock('@renderer/services/PyodideService', () => ({
  pyodideService: { runScript: vi.fn() }
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
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.code.execution.enabled': true,
      'chat.code.execution.timeout_minutes': 1,
      'chat.code.collapsible': false,
      'chat.code.wrappable': true,
      'chat.code.image_tools': false,
      'chat.message.font_size': 14,
      'chat.code.show_line_numbers': false,
      'chat.code.editor.enabled': true,
      'chat.code.editor.autocompletion': true,
      'chat.code.editor.fold_gutter': false,
      'chat.code.editor.highlight_active_line': false,
      'chat.code.editor.keymap': false,
      'chat.code.editor.theme_light': 'auto',
      'chat.code.editor.theme_dark': 'auto'
    })
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

  it('opens a UNC Markdown link through the host', async () => {
    mocks.readText.mockResolvedValue(String.raw`[Report](\\\\server\share\docs\report.md)`)
    const openFile = vi.fn()
    const user = userEvent.setup()

    renderArtifactPreview(openFile)
    await user.click(await screen.findByRole('link', { name: 'Report' }))

    expect(openFile).toHaveBeenCalledWith('\\\\server\\share\\docs\\report.md')
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

  it('keeps passive fenced-code actions without chat execution or HTML artifact controls', async () => {
    mocks.readText.mockResolvedValue(
      '```python\nprint("not executed")\n```\n\n```html\n<button>Not an artifact</button>\n```'
    )

    renderArtifactPreview(vi.fn())

    const codeBlocks = await screen.findAllByLabelText('Code viewer')
    expect(codeBlocks[0]).toHaveTextContent('print("not executed")')
    expect(codeBlocks[1]).toHaveTextContent('<button>Not an artifact</button>')
    expect(await screen.findAllByRole('button', { name: 'code_block.copy.source' })).toHaveLength(2)
    expect(screen.queryByRole('button', { name: 'code_block.run' })).not.toBeInTheDocument()
  })
})
