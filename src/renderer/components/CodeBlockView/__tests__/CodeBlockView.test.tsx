import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { CodeBlockView } from '../view'

const mocks = vi.hoisted(() => ({
  useCopyTool: vi.fn(),
  useDownloadTool: vi.fn(),
  useViewSourceTool: vi.fn(),
  useSplitViewTool: vi.fn(),
  useRunTool: vi.fn(),
  useExpandTool: vi.fn(),
  useWrapTool: vi.fn(),
  useSaveTool: vi.fn(),
  CodeToolbar: vi.fn(() => <div data-testid="code-toolbar" />),
  CodeEditor: vi.fn(({ value }) => <div data-testid="code-editor">{value}</div>),
  CodeViewer: vi.fn(({ value }) => <div data-testid="code-viewer">{value}</div>)
}))

vi.mock('@renderer/context/CodeStyleProvider', () => ({
  useCodeStyle: () => ({ activeCmTheme: 'light' })
}))

vi.mock('@cherrystudio/ui', () => ({
  CodeEditor: mocks.CodeEditor
}))

vi.mock('@renderer/components/CodeViewer', () => ({
  default: mocks.CodeViewer
}))

vi.mock('@renderer/components/CodeToolbar', () => ({
  CodeToolbar: mocks.CodeToolbar,
  useCopyTool: mocks.useCopyTool,
  useDownloadTool: mocks.useDownloadTool,
  useViewSourceTool: mocks.useViewSourceTool,
  useSplitViewTool: mocks.useSplitViewTool,
  useRunTool: mocks.useRunTool,
  useExpandTool: mocks.useExpandTool,
  useWrapTool: mocks.useWrapTool,
  useSaveTool: mocks.useSaveTool
}))

vi.mock('@renderer/services/PyodideService', () => ({
  pyodideService: {
    runScript: vi.fn()
  }
}))

describe('CodeBlockView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUsePreferenceUtils.resetMocks()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.code.execution.enabled': false,
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
  })

  it('renders a read-only viewer when editable is false even if the code editor setting is enabled', () => {
    render(
      <CodeBlockView language="javascript" editable={false} onSave={vi.fn()}>
        const value = 1
      </CodeBlockView>
    )

    expect(screen.queryByTestId('code-editor')).not.toBeInTheDocument()
    expect(screen.getByTestId('code-viewer')).toHaveTextContent('const value = 1')
    expect(mocks.useSaveTool).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: false
      })
    )
  })

  it('renders the editor and save tool when editable and the code editor setting are enabled', () => {
    render(
      <CodeBlockView language="javascript" editable onSave={vi.fn()}>
        const value = 1
      </CodeBlockView>
    )

    expect(screen.getByTestId('code-editor')).toHaveTextContent('const value = 1')
    expect(screen.queryByTestId('code-viewer')).not.toBeInTheDocument()
    expect(mocks.useSaveTool).toHaveBeenCalledWith(
      expect.objectContaining({
        enabled: true
      })
    )
  })
})
