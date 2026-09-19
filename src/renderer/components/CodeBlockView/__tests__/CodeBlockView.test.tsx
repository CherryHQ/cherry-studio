import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import { CodeBlockView } from '../CodeBlockView'

const mocks = vi.hoisted(() => ({
  CodeEditor: vi.fn(({ value, onSave }: { value: string; onSave?: (newContent: string) => void }) => (
    <div>
      <div role="textbox" aria-label="Code editor">
        {value}
      </div>
      <button type="button" onClick={() => onSave?.('const value = 2')}>
        Save from editor
      </button>
    </div>
  )),
  CodeViewer: vi.fn(({ value }: { value: string }) => <pre aria-label="Code viewer">{value}</pre>),
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

vi.mock('@renderer/components/Preview/MermaidPreview', () => ({
  default: () => <div aria-label="Mermaid preview" />
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

  it('shows settled editable code in the viewer until edit is requested', async () => {
    const user = userEvent.setup()
    render(
      <CodeBlockView language="javascript" editable onSave={vi.fn()}>
        const value = 1
      </CodeBlockView>
    )

    expect(screen.getByLabelText('Code viewer')).toHaveTextContent('const value = 1')
    expect(screen.queryByRole('textbox', { name: 'Code editor' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'code_block.edit.label' }))

    expect(screen.getByRole('textbox', { name: 'Code editor' })).toHaveTextContent('const value = 1')
    expect(screen.getByRole('textbox', { name: 'Code editor' }).closest('[data-ui~="part:code-block"]')).not.toBeNull()
    expect(screen.queryByLabelText('Code viewer')).not.toBeInTheDocument()
  })

  it('returns to the viewer when editing is cancelled', async () => {
    const user = userEvent.setup()
    render(
      <CodeBlockView language="javascript" editable onSave={vi.fn()}>
        const value = 1
      </CodeBlockView>
    )

    await user.click(screen.getByRole('button', { name: 'code_block.edit.label' }))
    await user.click(screen.getByRole('button', { name: 'common.cancel' }))

    expect(screen.getByLabelText('Code viewer')).toHaveTextContent('const value = 1')
    expect(screen.queryByRole('textbox', { name: 'Code editor' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'code_block.edit.label' })).toBeInTheDocument()
  })

  it('leaves edit mode once the save succeeds', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(true)
    render(
      <CodeBlockView language="javascript" editable onSave={onSave}>
        const value = 1
      </CodeBlockView>
    )

    await user.click(screen.getByRole('button', { name: 'code_block.edit.label' }))
    await user.click(screen.getByRole('button', { name: 'Save from editor' }))

    expect(onSave).toHaveBeenCalledWith('const value = 2')
    expect(await screen.findByLabelText('Code viewer')).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Code editor' })).not.toBeInTheDocument()
  })

  it('ignores a save that settles after the editor was closed and reopened', async () => {
    const user = userEvent.setup()
    let finishSave: (saved: boolean) => void = () => {}
    const onSave = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishSave = resolve
        })
    )
    render(
      <CodeBlockView language="javascript" editable onSave={onSave}>
        const value = 1
      </CodeBlockView>
    )

    await user.click(screen.getByRole('button', { name: 'code_block.edit.label' }))
    await user.click(screen.getByRole('button', { name: 'Save from editor' }))
    await user.click(screen.getByRole('button', { name: 'common.cancel' }))
    await user.click(screen.getByRole('button', { name: 'code_block.edit.label' }))

    await act(async () => finishSave(true))

    expect(screen.getByRole('textbox', { name: 'Code editor' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Code viewer')).not.toBeInTheDocument()
  })

  it('ignores a save that settles after the split preview was restored to the editor', async () => {
    const user = userEvent.setup()
    let finishSave: (saved: boolean) => void = () => {}
    const onSave = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finishSave = resolve
        })
    )
    render(
      <CodeBlockView language="mermaid" editable onSave={onSave}>
        graph TD
      </CodeBlockView>
    )

    await user.click(screen.getByRole('button', { name: 'code_block.edit.label' }))
    await user.click(screen.getByRole('button', { name: 'Save from editor' }))
    await user.click(screen.getByRole('button', { name: 'code_block.more' }))
    await user.click(screen.getByRole('button', { name: 'code_block.split.label' }))
    await user.click(screen.getByRole('button', { name: 'code_block.split.restore' }))

    await act(async () => finishSave(true))

    expect(screen.getByRole('textbox', { name: 'Code editor' })).toBeInTheDocument()
    expect(screen.queryByLabelText('Mermaid preview')).not.toBeInTheDocument()
  })

  it('leaves split edit mode once the save succeeds', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(true)
    render(
      <CodeBlockView language="mermaid" editable onSave={onSave}>
        graph TD
      </CodeBlockView>
    )

    await user.click(screen.getByRole('button', { name: 'code_block.edit.label' }))
    await user.click(screen.getByRole('button', { name: 'code_block.more' }))
    await user.click(screen.getByRole('button', { name: 'code_block.split.label' }))
    expect(screen.getByRole('textbox', { name: 'Code editor' })).toBeInTheDocument()
    expect(await screen.findByLabelText('Mermaid preview')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save from editor' }))

    await waitFor(() => expect(screen.queryByRole('textbox', { name: 'Code editor' })).not.toBeInTheDocument())
    expect(screen.getByLabelText('Mermaid preview')).toBeInTheDocument()
    expect(screen.queryByLabelText('Code viewer')).not.toBeInTheDocument()
  })

  it('stays in edit mode when the save fails', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(false)
    render(
      <CodeBlockView language="javascript" editable onSave={onSave}>
        const value = 1
      </CodeBlockView>
    )

    await user.click(screen.getByRole('button', { name: 'code_block.edit.label' }))
    await user.click(screen.getByRole('button', { name: 'Save from editor' }))

    expect(onSave).toHaveBeenCalledWith('const value = 2')
    expect(screen.getByRole('textbox', { name: 'Code editor' })).toBeInTheDocument()
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
