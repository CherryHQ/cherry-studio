import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import MarkdownEditor from '../MarkdownEditor'

let resumePreview: (() => void) | undefined
let pendingPreview: Promise<void> | undefined
let previewReady = false

vi.mock('@renderer/components/markdown', () => ({
  StaticMarkdown: ({ children }: { children: string }) => {
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
  }
}))

function ControlledMarkdownEditor() {
  const [value, setValue] = useState('initial notes')
  return <MarkdownEditor value={value} onChange={setValue} />
}

describe('MarkdownEditor', () => {
  it('updates the textarea while the deferred preview is still rendering', async () => {
    const user = userEvent.setup()
    render(<ControlledMarkdownEditor />)

    const textarea = screen.getByRole('textbox')
    await user.click(textarea)
    await user.keyboard('{Control>}a{/Control}')
    await user.paste('updated notes')

    expect(textarea).toHaveValue('updated notes')
    expect(screen.getByText('initial notes')).toBeVisible()

    await act(async () => {
      resumePreview?.()
      await pendingPreview
    })

    expect(screen.getByText('updated notes', { selector: 'div' })).toBeVisible()
  })
})
