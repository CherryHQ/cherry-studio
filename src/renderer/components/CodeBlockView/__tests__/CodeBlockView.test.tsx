import type * as CherryStudioUi from '@cherrystudio/ui'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

vi.mock('@renderer/components/CodeViewer', () => ({
  default: mocks.CodeViewer
}))

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeCmTheme: 'light' }),
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

  it('uses the editor for editable code that is already settled', () => {
    render(
      <CodeBlockView language="javascript" editable onSave={vi.fn()}>
        const value = 1
      </CodeBlockView>
    )

    expect(screen.getByRole('textbox', { name: 'Code editor' })).toHaveTextContent('const value = 1')
    expect(screen.getByRole('textbox', { name: 'Code editor' }).closest('[data-ui~="part:code-block"]')).not.toBeNull()
    expect(screen.queryByLabelText('Code viewer')).not.toBeInTheDocument()
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

  it('caps display-only code and suppresses its toolbar', () => {
    render(
      <CodeBlockView language="html" editable={false} isStreaming maxHeight={350} showToolbar={false}>
        {'<h1>Hello</h1>'}
      </CodeBlockView>
    )

    expect(screen.getByLabelText('Code viewer')).toHaveTextContent('<h1>Hello</h1>')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(mocks.CodeViewer).toHaveBeenLastCalledWith(
      expect.objectContaining({
        autoScrollToBottom: true,
        expanded: false,
        maxHeight: '350px'
      }),
      undefined
    )
  })

  it.each([
    { collapsible: true, expectedAutoScroll: true, expectedExpanded: false, name: 'collapsed' },
    { collapsible: false, expectedAutoScroll: false, expectedExpanded: true, name: 'expanded' }
  ])(
    'disables highlighting and sets auto-scroll correctly for $name streaming code',
    ({ collapsible, expectedAutoScroll, expectedExpanded }) => {
      MockUsePreferenceUtils.setPreferenceValue('chat.code.collapsible', collapsible)

      render(
        <CodeBlockView language="javascript" editable isStreaming>
          const value = 1
        </CodeBlockView>
      )

      expect(screen.getByLabelText('Code viewer')).toHaveTextContent('const value = 1')
      expect(screen.queryByRole('textbox', { name: 'Code editor' })).not.toBeInTheDocument()
      expect(mocks.CodeViewer).toHaveBeenLastCalledWith(
        expect.objectContaining({
          autoScrollToBottom: expectedAutoScroll,
          expanded: expectedExpanded,
          options: {
            highlight: false
          }
        }),
        undefined
      )
    }
  )

  it('keeps the same viewer while streaming settles and enables highlighting in place', () => {
    const { rerender } = render(
      <CodeBlockView language="javascript" editable isStreaming>
        const value =
      </CodeBlockView>
    )
    const viewer = screen.getByLabelText('Code viewer')

    expect(mocks.CodeViewer).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: { highlight: false } }),
      undefined
    )
    expect(screen.queryByRole('button', { name: 'code_block.edit.label' })).not.toBeInTheDocument()

    rerender(
      <CodeBlockView language="javascript" editable>
        const value = 1
      </CodeBlockView>
    )

    expect(screen.getByLabelText('Code viewer')).toBe(viewer)
    expect(screen.getByRole('button', { name: 'code_block.edit.label' })).toBeInTheDocument()
    expect(viewer).toHaveTextContent('const value = 1')
    expect(mocks.CodeViewer).toHaveBeenLastCalledWith(
      expect.objectContaining({ options: { highlight: true } }),
      undefined
    )
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

  it('wraps long lines when an ancestor requests wrap even if chat wrap is off', () => {
    // Regression: a narrow surface (selection-action results) must wrap without
    // flipping the chat `chat.code.wrappable` preference.
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.code.wrappable': false,
      'chat.code.editor.enabled': false
    })
    const longLine = `const token = '${'a'.repeat(240)}'`

    render(
      <CodeBlockWrapLinesContext value={true}>
        <CodeBlockView language="javascript" editable={false}>
          {longLine}
        </CodeBlockView>
      </CodeBlockWrapLinesContext>
    )

    expect(screen.getByLabelText('Code viewer')).toHaveAttribute('data-wrapped', 'true')
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

    expect(screen.getByLabelText('Code viewer')).toHaveAttribute('data-wrapped', 'true')
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

  it('keeps chat wrap off when no ancestor requested wrap', () => {
    MockUsePreferenceUtils.setMultiplePreferenceValues({
      'chat.code.wrappable': false,
      'chat.code.editor.enabled': false
    })

    render(
      <CodeBlockView language="javascript" editable={false}>
        const token = 'short'
      </CodeBlockView>
    )

    expect(screen.getByLabelText('Code viewer')).toHaveAttribute('data-wrapped', 'false')
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
