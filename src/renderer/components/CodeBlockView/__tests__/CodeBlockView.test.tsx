import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import { CodeBlockView } from '../CodeBlockView'
import { CodeBlockWrapLinesContext } from '../wrapLinesContext'

const mocks = vi.hoisted(() => ({
  CodeEditor: vi.fn(({ value }: { value: string }) => (
    <div role="textbox" aria-label="Code editor">
      {value}
    </div>
  )),
  CodeViewer: vi.fn(({ value, wrapped }: { value: string; wrapped?: boolean }) => (
    <pre aria-label="Code viewer" data-wrapped={wrapped ? 'true' : 'false'}>
      {value}
    </pre>
  )),
  runScript: vi.fn(),
  t: (key: string) => key,
  writeText: vi.fn()
}))

vi.mock('@cherrystudio/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof CherryStudioUi>()),
  CodeEditor: mocks.CodeEditor
}))

vi.mock('@renderer/components/LazyCodeEditor', () => ({
  LazyCodeEditor: mocks.CodeEditor
}))

vi.mock('@renderer/components/CodeViewer', () => ({
  default: mocks.CodeViewer
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ isCodeThemeDark: false }),
  useCmTheme: () => 'light'
}))

vi.mock('@renderer/services/PyodideService', () => ({
  pyodideService: {
    runScript: mocks.runScript
  }
}))

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: mocks.t })
}))

describe('CodeBlockView', () => {
  it('keeps the sticky toolbar attached to the message scroll container', () => {
    render(
      <CodeBlockView language="javascript" editable={false}>
        const value = 1
      </CodeBlockView>
    )

    const codeBlock = screen.getByLabelText('Code viewer').closest('[data-ui~="part:code-block"]')

    expect(codeBlock).toHaveClass('overflow-clip')
    expect(codeBlock).not.toHaveClass('overflow-hidden')
  })

  beforeEach(() => {
    vi.clearAllMocks()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.writeText }
    })
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

  it('opens the editor only after requesting editing and can return to reading', async () => {
    const user = userEvent.setup()
    render(
      <CodeBlockView language="javascript" editable onSave={vi.fn()}>
        const value = 1
      </CodeBlockView>
    )

    expect(screen.queryByRole('textbox', { name: 'Code editor' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'code_block.edit.label' }))
    expect(screen.getByRole('textbox', { name: 'Code editor' })).toHaveTextContent('const value = 1')
    expect(screen.getByRole('textbox', { name: 'Code editor' }).closest('[data-ui~="part:code-block"]')).not.toBeNull()
    expect(screen.queryByLabelText('Code viewer')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'preview.label' }))
    expect(screen.getByLabelText('Code viewer')).toHaveTextContent('const value = 1')
  })

  it('uses the viewer for read-only code', () => {
    render(
      <CodeBlockView language="javascript" editable={false}>
        const value = 1
      </CodeBlockView>
    )

    expect(screen.getByLabelText('Code viewer')).toHaveTextContent('const value = 1')
    expect(screen.queryByRole('textbox', { name: 'Code editor' })).not.toBeInTheDocument()
  })

  it('renders display-only code without a toolbar', () => {
    render(
      <CodeBlockView language="html" editable={false} isStreaming maxHeight={350} showToolbar={false}>
        {'<h1>Hello</h1>'}
      </CodeBlockView>
    )

    expect(screen.getByLabelText('Code viewer')).toHaveTextContent('<h1>Hello</h1>')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it.each([true, false])('keeps streaming code readable with collapsible=%s', (collapsible) => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.collapsible', collapsible)
    render(
      <CodeBlockView language="javascript" editable isStreaming>
        const value = 1
      </CodeBlockView>
    )
    expect(screen.getByLabelText('Code viewer')).toHaveTextContent('const value = 1')
    expect(screen.queryByRole('textbox', { name: 'Code editor' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'code_block.edit.label' })).not.toBeInTheDocument()
  })

  it('keeps the same viewer while streaming settles and makes editing available', () => {
    const { rerender } = render(
      <CodeBlockView language="javascript" editable isStreaming>
        const value =
      </CodeBlockView>
    )
    const viewer = screen.getByLabelText('Code viewer')

    expect(screen.queryByRole('button', { name: 'code_block.edit.label' })).not.toBeInTheDocument()

    rerender(
      <CodeBlockView language="javascript" editable>
        const value = 1
      </CodeBlockView>
    )

    expect(screen.getByLabelText('Code viewer')).toBe(viewer)
    expect(screen.getByRole('button', { name: 'code_block.edit.label' })).toBeInTheDocument()
    expect(viewer).toHaveTextContent('const value = 1')
  })

  it('keeps toolbar actions mounted and copies the latest streamed source', async () => {
    const user = userEvent.setup()
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: mocks.writeText }
    })
    const { rerender } = render(
      <CodeBlockView language="javascript" editable isStreaming>
        const value =
      </CodeBlockView>
    )
    const copyButton = screen.getByRole('button', { name: 'code_block.copy.source' })

    rerender(
      <CodeBlockView language="javascript" editable isStreaming>
        const value = 1
      </CodeBlockView>
    )

    expect(screen.getByRole('button', { name: 'code_block.copy.source' })).toBe(copyButton)
    await user.click(copyButton)
    expect(mocks.writeText).toHaveBeenCalledWith('const value = 1')
  })

  it('runs Python and displays the execution result', async () => {
    const user = userEvent.setup()
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.code.execution.enabled': true,
      'chat.code.wrappable': false
    })
    mocks.runScript.mockResolvedValue({ text: 'completed' })
    render(<CodeBlockView language="python">print(42)</CodeBlockView>)

    await user.click(screen.getByRole('button', { name: 'code_block.run' }))

    expect(mocks.runScript).toHaveBeenCalledWith('print(42)', {}, 60_000)
    expect(await screen.findByText('completed')).toBeInTheDocument()
  })

  it('hides the wrap toggle when wrap is forced even if chat wrap is on', () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.code.wrappable': true,
      'chat.code.editor.enabled': false
    })

    render(
      <CodeBlockWrapLinesContext value={true}>
        <CodeBlockView language="javascript" editable={false}>
          const token = 'short'
        </CodeBlockView>
      </CodeBlockWrapLinesContext>
    )

    expect(screen.queryByRole('button', { name: 'code_block.wrap.off' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'code_block.wrap.on' })).not.toBeInTheDocument()
  })

  it('keeps the wrap toggle in ordinary chat when wrap is not forced', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.editor.enabled', false)

    render(
      <CodeBlockView language="javascript" editable={false}>
        const token = 'short'
      </CodeBlockView>
    )

    expect(screen.getByRole('button', { name: 'code_block.wrap.off' })).toBeInTheDocument()
  })

  it('keeps passive tools while suppressing Python execution when execution is not allowed', () => {
    MockUsePreferenceUtils.setPreferenceValue('chat.code.execution.enabled', true)

    render(
      <CodeBlockView language="python" editable={false} allowExecution={false}>
        print(42)
      </CodeBlockView>
    )

    expect(screen.getByRole('button', { name: 'code_block.copy.source' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'code_block.run' })).not.toBeInTheDocument()
  })
})
