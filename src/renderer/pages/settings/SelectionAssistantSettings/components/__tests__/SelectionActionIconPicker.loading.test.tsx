import '@testing-library/jest-dom/vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

const modules = vi.hoisted(() => ({ dynamic: vi.fn(), tags: vi.fn() }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }))
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
vi.mock('lucide-react/dynamic', () => {
  modules.dynamic()
  return { iconNames: ['languages'], DynamicIcon: () => <svg /> }
})
vi.mock('../selectionIconTags.json', () => {
  modules.tags()
  return { default: { languages: ['translate'] } }
})

import SelectionActionIconPicker from '../SelectionActionIconPicker'

describe('SelectionActionIconPicker loading', () => {
  it('does not load the full icon map or search tags for an empty or built-in editor until opened', async () => {
    const { rerender } = render(<SelectionActionIconPicker value="" onChange={vi.fn()} />)
    expect(modules.dynamic).not.toHaveBeenCalled()
    expect(modules.tags).not.toHaveBeenCalled()
    rerender(<SelectionActionIconPicker value="bot" onChange={vi.fn()} />)
    expect(modules.dynamic).not.toHaveBeenCalled()
    expect(modules.tags).not.toHaveBeenCalled()
    fireEvent.click(screen.getByText('bot'))
    await screen.findByRole('textbox', { name: 'common.search' })
    await waitFor(() => expect(modules.dynamic).toHaveBeenCalledOnce())
    expect(modules.tags).toHaveBeenCalledOnce()
  })
})
