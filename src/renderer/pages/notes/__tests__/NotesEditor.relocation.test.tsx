import { act, render, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'

import { trackPendingNotesImagePaste } from '@renderer/hooks/notesFileEditFlush'
const m = vi.hoisted(() => ({ props: null as any }))
vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const C = ({ children }: any) => React.createElement('div', {}, children)
  return { Button: C, EmptyState: C, Skeleton: C, SpaceBetweenRowFlex: C, Tooltip: C }
})
vi.mock('@renderer/hooks/useNotesSettings', () => ({
  useNotesSettings: () => ({ settings: { defaultViewMode: 'edit', defaultEditMode: 'preview' } })
}))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }))
vi.mock('@renderer/components/RichEditor/RichEditor', () => ({
  default: (props: any) => {
    m.props = props
    return <div />
  }
}))
vi.mock('@renderer/components/Selector', () => ({ default: () => <div /> }))
import NotesEditor from '../NotesEditor'
describe('NotesEditor relocation callback safety', () => {
  it('blocks fresh edits while locked but accepts final pending-paste content and blocks read-only content', async () => {
    const change = vi.fn()
    const props = {
      activeNodeId: '/notes/a.md',
      currentContent: 'old',
      tokenCount: 3,
      editorRef: { current: null },
      codeEditorRef: { current: null },
      onMarkdownChange: change
    }
    const view = render(<NotesEditor {...props} />)
    await waitFor(() => expect(m.props).toBeTruthy())
    await act(() => m.props.onMarkdownChange('normal'))
    expect(change).toHaveBeenLastCalledWith('normal')
    view.rerender(<NotesEditor {...props} editsLocked />)
    await act(() => m.props.onMarkdownChange('blocked'))
    expect(change).toHaveBeenCalledTimes(1)
    expect(m.props.editable).toBe(false)
    let done!: () => void
    const pending = trackPendingNotesImagePaste(
      new Promise<void>((r) => {
        done = r
      })
    )
    await act(() => m.props.onMarkdownChange('pasted final'))
    expect(change).toHaveBeenLastCalledWith('pasted final')
    view.rerender(<NotesEditor {...props} editsLocked readOnly />)
    await act(() => m.props.onMarkdownChange('readonly'))
    expect(change).toHaveBeenCalledTimes(2)
    await act(async () => {
      done()
      await pending
    })
    view.rerender(<NotesEditor {...props} editsLocked />)
    await act(() => m.props.onMarkdownChange('after paste'))
    expect(change).toHaveBeenCalledTimes(2)
    view.rerender(<NotesEditor {...props} />)
    await act(() => m.props.onMarkdownChange('resumed'))
    expect(change).toHaveBeenLastCalledWith('resumed')
  })
})
