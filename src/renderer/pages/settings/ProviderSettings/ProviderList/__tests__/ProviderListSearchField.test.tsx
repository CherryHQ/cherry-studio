import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import ProviderListSearchField from '../ProviderListSearchField'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string) => key
    })
  }
})

describe('ProviderListSearchField', () => {
  it('shows and handles the clear button when search has text', () => {
    const onValueChange = vi.fn()

    render(<ProviderListSearchField value="openai" disabled={false} onValueChange={onValueChange} />)

    fireEvent.click(screen.getByRole('button', { name: 'common.clear' }))

    expect(onValueChange).toHaveBeenCalledWith('')
  })

  it('hides the clear button when search is empty', () => {
    render(<ProviderListSearchField value="" disabled={false} onValueChange={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'common.clear' })).not.toBeInTheDocument()
  })
})
