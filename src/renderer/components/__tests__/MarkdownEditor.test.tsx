import { act, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import MarkdownEditor from '../MarkdownEditor'

let resumePreview: (() => void) | undefined
let pendingPreview: Promise<void> | undefined
let previewReady = false

vi.mock('@cherrystudio/ui', () => ({
  defaultMarkdownPlugins: { cjk: [] },
  Markdown: ({ children }: { children: string }) => {
    if (children === 'updated notes' && !previewReady) {
      pendingPreview ??= new Promise<void>((resolve) => {
        resumePreview = () => {
          previewReady = true
          resolve()
        }
      })
      throw pendingPreview
    }

    return <div>{children}</div>
  },
  withMath: () => []
}))

function ControlledMarkdownEditor() {
  const [value, setValue] = useState('initial notes')
  return <MarkdownEditor value={value} onChange={setValue} />
}

describe('MarkdownEditor', () => {
  it('updates the textarea while the deferred preview is still rendering', async () => {
    render(<ControlledMarkdownEditor />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'updated notes' } })

    expect(textarea).toHaveValue('updated notes')
    expect(screen.getByText('initial notes')).toBeVisible()

    await act(async () => {
      resumePreview?.()
      await pendingPreview
    })

    expect(screen.getByText('updated notes', { selector: 'div' })).toBeVisible()
  })
})
