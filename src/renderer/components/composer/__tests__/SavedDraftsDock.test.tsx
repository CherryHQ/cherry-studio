import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import i18n from '@renderer/i18n/resolver'

vi.unmock('@cherrystudio/ui')

import { SavedDraftsDock } from '../SavedDraftsDock'

const items = [{ id: '1', draft: { text: 'parked prompt', tokens: [] }, files: [] }] as any

describe('SavedDraftsDock', () => {
  beforeAll(async () => {
    await i18n.changeLanguage('en-US')
  })

  it('reveals the row actions for keyboard focus, not only on hover', async () => {
    render(<SavedDraftsDock items={items} onEdit={vi.fn()} onRemove={vi.fn()} />)

    await userEvent.click(screen.getByRole('button', { name: 'Saved drafts (1)' }))
    const edit = screen.getByRole('button', { name: 'Edit draft' })
    edit.focus()

    expect(edit).toHaveFocus()
    // Without a focus-within reveal the focused button and its focus ring stay invisible.
    let wrapper = edit.parentElement
    while (wrapper && !wrapper.className.includes('transition-opacity')) {
      wrapper = wrapper.parentElement
    }
    expect(wrapper?.className).toContain('opacity-0')
    expect(wrapper?.className).toContain('group-focus-within:opacity-100')
  })
})
