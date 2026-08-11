import { act, render, waitFor } from '@testing-library/react'
import { EditorContent, useEditor } from '@tiptap/react'
import { useMemo } from 'react'
import { describe, expect, it } from 'vitest'

import { ComposerDocument, ComposerParagraph, ComposerText } from '../../../composer/composerSchema'
import { Placeholder } from '../placeholder'

function PlaceholderHarness({ placeholder }: { placeholder: string }) {
  const extensions = useMemo(
    () => [
      ComposerDocument,
      ComposerParagraph,
      ComposerText,
      Placeholder.configure({
        placeholder,
        showOnlyWhenEditable: true,
        showOnlyCurrent: true,
        includeChildren: false
      })
    ],
    [placeholder]
  )
  const editor = useEditor({
    extensions,
    content: { type: 'doc', content: [{ type: 'paragraph' }] }
  })

  return <EditorContent editor={editor} />
}

describe('Placeholder', () => {
  it('updates the visible placeholder without recreating the editor', async () => {
    const { container, rerender } = render(<PlaceholderHarness placeholder="Initial placeholder" />)

    await waitFor(() => {
      expect(container.querySelector('.placeholder')).toHaveAttribute('data-placeholder', 'Initial placeholder')
    })
    const editorElement = container.querySelector('.ProseMirror')
    expect(editorElement).not.toBeNull()

    act(() => {
      rerender(<PlaceholderHarness placeholder="Updated placeholder" />)
    })

    await waitFor(() => {
      expect(container.querySelector('.placeholder')).toHaveAttribute('data-placeholder', 'Updated placeholder')
    })
    expect(container.querySelector('.ProseMirror')).toBe(editorElement)
  })
})
