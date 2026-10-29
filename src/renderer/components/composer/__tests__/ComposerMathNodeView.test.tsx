import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Editor } from '@tiptap/core'
import { EditorContent, useEditor } from '@tiptap/react'
import { useEffect } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as CherryUI from '@cherrystudio/ui'
import { toast } from '@renderer/services/toast'

import { COMPOSER_INPUT_MAX_LENGTH, serializeComposerDocument } from '../composerDraft'
import { configureComposerInlineMath, synchronizeComposerMath } from '../composerMathExtension'
import { createComposerEditorPreset } from '../composerPreset'
import { tokenizePromptVariablesInEditor } from '../promptVariables'

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  const { Button, Input, Label, Popover, PopoverContent, PopoverTrigger } = await importOriginal<typeof CherryUI>()
  return { Button, Input, Label, Popover, PopoverContent, PopoverTrigger }
})

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))

function Harness({ onEditor, enabled }: { onEditor: (editor: Editor) => void; enabled: () => boolean }) {
  const editor = useEditor({
    extensions: [...createComposerEditorPreset({}), configureComposerInlineMath(enabled)],
    editorProps: { handleScrollToSelection: () => true },
    onUpdate: ({ editor, transaction }) => tokenizePromptVariablesInEditor(editor, transaction),
    content: { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'inlineMath', attrs: { latex: 'x' } }] }] }
  })
  useEffect(() => {
    if (editor) onEditor(editor)
  }, [editor, onEditor])
  return <EditorContent editor={editor} />
}

describe('ComposerMathNodeView', () => {
  let editor: Editor
  let enabled = true

  async function setup() {
    enabled = true
    const user = userEvent.setup()
    const onKeyDown = vi.fn()
    render(
      <div role="presentation" onKeyDown={onKeyDown}>
        <Harness
          onEditor={(value) => {
            editor = value
          }}
          enabled={() => enabled}
        />
      </div>
    )
    const trigger = await screen.findByRole('button', { name: 'chat.input.math.edit' })
    return { user, trigger, onKeyDown }
  }

  function content() {
    return editor.getJSON().content?.[0].content ?? []
  }

  afterEach(() => cleanup())

  it('opens raw latex, confirms edits, and gives each panel action its own history item', async () => {
    const { user, trigger } = await setup()
    await user.click(trigger)
    expect(screen.getByRole('dialog', { name: 'chat.input.math.edit' })).toBeVisible()
    const input = screen.getByRole('textbox', { name: 'chat.input.math.source' })
    expect(input).toHaveValue('x')
    await user.clear(input)
    await user.type(input, 'x^2')
    await user.click(screen.getByRole('button', { name: 'common.confirm' }))
    expect(content()).toEqual([{ type: 'inlineMath', attrs: { latex: 'x^2' } }])
    expect(serializeComposerDocument(editor).text).toBe('$x^2$')
    act(() => {
      editor.commands.insertContent('!')
    })
    act(() => {
      editor.commands.undo()
    })
    expect(serializeComposerDocument(editor).text).toBe('$x^2$')
    act(() => {
      editor.commands.undo()
    })
    expect(content()).toEqual([{ type: 'inlineMath', attrs: { latex: 'x' } }])
  })

  it('cancels and escapes without editing and restores trigger focus', async () => {
    const { user, trigger } = await setup()
    await user.click(trigger)
    await user.type(screen.getByRole('textbox', { name: 'chat.input.math.source' }), '^2')
    await user.click(screen.getByRole('button', { name: 'common.cancel' }))
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(serializeComposerDocument(editor).text).toBe('$x$')
    await user.keyboard('{Enter}')
    expect(screen.getByRole('dialog')).toBeVisible()
    await user.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(serializeComposerDocument(editor).text).toBe('$x$')
    await user.keyboard(' ')
    expect(screen.getByRole('dialog')).toBeVisible()
  })

  it('deletes at the live node position and returns focus to the editor', async () => {
    const { user, trigger } = await setup()
    await user.click(trigger)
    act(() => {
      editor.commands.insertContentAt(1, 'prefix ')
    })
    await user.click(screen.getByRole('button', { name: 'common.delete' }))
    expect(content()).toEqual([{ type: 'text', text: 'prefix ' }])
    expect(serializeComposerDocument(editor).text).toBe('prefix ')
    await waitFor(() => expect(editor.view.dom).toHaveFocus())
    expect(editor.state.selection.from).toBe(8)
    act(() => {
      editor.commands.undo()
    })
    expect(serializeComposerDocument(editor).text).toBe('prefix $x$')
  })

  it.each(['x^{', '${name}'])('falls back to literal editable source for invalid latex %s', async (value) => {
    const { user, trigger } = await setup()
    await user.click(trigger)
    fireEvent.change(screen.getByRole('textbox', { name: 'chat.input.math.source' }), { target: { value } })
    await user.click(screen.getByRole('button', { name: 'common.confirm' }))
    expect(content()).toEqual([{ type: 'text', text: `$${value}$` }])
    expect(serializeComposerDocument(editor).text).toBe(`$${value}$`)
    expect(screen.queryByTestId('composer-inline-math')).toBeNull()
  })

  it('keeps overlength edits open without submitting the document', async () => {
    const { user, trigger } = await setup()
    await user.click(trigger)
    const value = 'x'.repeat(COMPOSER_INPUT_MAX_LENGTH)
    fireEvent.change(screen.getByRole('textbox', { name: 'chat.input.math.source' }), { target: { value } })
    await user.click(screen.getByRole('button', { name: 'common.confirm' }))
    expect(toast.error).toHaveBeenCalledWith('chat.input.math.length_exceeded')
    expect(screen.getByRole('textbox', { name: 'chat.input.math.source' })).toHaveValue(value)
    expect(content()).toEqual([{ type: 'inlineMath', attrs: { latex: 'x' } }])
  })

  it('isolates panel Enter from sending and ignores composing Enter', async () => {
    const { user, trigger, onKeyDown } = await setup()
    await user.click(trigger)
    const input = screen.getByRole('textbox', { name: 'chat.input.math.source' })
    fireEvent.change(input, { target: { value: 'y' } })
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true })
    expect(screen.getByRole('dialog')).toBeVisible()
    expect(serializeComposerDocument(editor).text).toBe('$x$')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(serializeComposerDocument(editor).text).toBe('$y$')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(onKeyDown).not.toHaveBeenCalled()
  })

  it.each(['cancel', 'delete'])('preserves native Enter activation on %s without confirming edits', async (action) => {
    const { user, trigger, onKeyDown } = await setup()
    if (action === 'cancel') {
      for (const name of ['chat.input.math.source', 'common.cancel', 'common.delete', 'common.confirm']) {
        await user.click(trigger)
        fireEvent.change(screen.getByRole('textbox', { name: 'chat.input.math.source' }), { target: { value: 'y' } })
        screen.getByRole(name === 'chat.input.math.source' ? 'textbox' : 'button', { name }).focus()
        await user.keyboard('{Escape}')
        expect(screen.queryByRole('dialog')).toBeNull()
        expect(content()).toEqual([{ type: 'inlineMath', attrs: { latex: 'x' } }])
        expect(onKeyDown).not.toHaveBeenCalled()
      }
    }
    await user.click(trigger)
    fireEvent.change(screen.getByRole('textbox', { name: 'chat.input.math.source' }), { target: { value: 'y' } })
    const button = screen.getByRole('button', { name: `common.${action}` })
    button.focus()
    const uncanceled = fireEvent.keyDown(button, { key: 'Enter' })
    expect(serializeComposerDocument(editor).text).toBe('$x$')
    expect(content()).toEqual([{ type: 'inlineMath', attrs: { latex: 'x' } }])
    expect(uncanceled).toBe(true)
    expect(onKeyDown).not.toHaveBeenCalled()
    expect(button).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(content()).toEqual(action === 'cancel' ? [{ type: 'inlineMath', attrs: { latex: 'x' } }] : [])
    expect(onKeyDown).not.toHaveBeenCalled()

    if (action === 'cancel') {
      await user.click(trigger)
      fireEvent.change(screen.getByRole('textbox', { name: 'chat.input.math.source' }), { target: { value: 'y' } })
      screen.getByRole('button', { name: 'common.confirm' }).focus()
      await user.keyboard('{Enter}')
      expect(content()).toEqual([{ type: 'inlineMath', attrs: { latex: 'y' } }])
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(onKeyDown).not.toHaveBeenCalled()
    }
  })

  it('expands math recovered by undo and redo after a panel edit while disabled', async () => {
    const { user, trigger } = await setup()
    await user.click(trigger)
    fireEvent.change(screen.getByRole('textbox', { name: 'chat.input.math.source' }), { target: { value: 'y' } })
    await user.click(screen.getByRole('button', { name: 'common.confirm' }))
    act(() => {
      enabled = false
      synchronizeComposerMath(editor, enabled)
    })
    expect(content()).toEqual([{ type: 'text', text: '$y$' }])
    act(() => {
      editor.commands.undo()
    })
    expect(content()).toEqual([{ type: 'text', text: '$x$' }])
    act(() => {
      editor.commands.redo()
    })
    expect(content()).toEqual([{ type: 'text', text: '$y$' }])
  })

  it('closes on read-only, preference disable, node removal, and editor destruction', async () => {
    const { user, trigger } = await setup()
    await user.click(trigger)
    act(() => {
      editor.setEditable(false)
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    act(() => {
      editor.setEditable(true)
    })
    await user.click(trigger)
    act(() => {
      enabled = false
      synchronizeComposerMath(editor, enabled)
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(content()).toEqual([{ type: 'text', text: '$x$' }])
    act(() => {
      enabled = true
      synchronizeComposerMath(editor, enabled)
    })
    await user.click(await screen.findByRole('button', { name: 'chat.input.math.edit' }))
    act(() => {
      editor.commands.clearContent()
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    act(() => {
      editor.commands.insertContent('$x$')
    })
    await user.click(await screen.findByRole('button', { name: 'chat.input.math.edit' }))
    act(() => {
      editor.destroy()
    })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})
