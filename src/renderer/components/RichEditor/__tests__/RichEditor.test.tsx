import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/hooks/useCodeStyle', () => ({
  useCodeStyle: () => ({ activeShikiTheme: 'one-light' })
}))

import RichEditor from '../RichEditor'

describe('RichEditor accessibility', () => {
  // Asserted on the attribute rather than through `getByRole('textbox', { name })`: ProseMirror
  // leaves the contenteditable without an explicit `role`, and giving every editor in the app one
  // changes how assistive tech navigates rich content — a separate decision from naming this one.
  it('names the editing surface for callers with no visible label', () => {
    const { container } = render(<RichEditor initialContent="" autoFocus={false} ariaLabel="Content" />)

    expect(container.querySelector('[contenteditable="true"]')).toHaveAttribute('aria-label', 'Content')
  })

  it('leaves the editing surface unnamed when no label is supplied', () => {
    const { container } = render(<RichEditor initialContent="" autoFocus={false} />)

    expect(container.querySelector('[contenteditable="true"]')).not.toHaveAttribute('aria-label')
  })
})
