// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

vi.mock('@cherrystudio/ui', async (importOriginal) => {
  return await importOriginal<typeof CherryStudioUi>()
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key
  })
}))

import { AgentLanguageField } from '../AgentLanguageField'

const props = {
  nullOptionLabel: 'Follow conversation language',
  customPlaceholder: 'Type a language',
  comboLabel: 'Reply language preset',
  inputLabel: 'Custom reply language'
}

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AgentLanguageField', () => {
  it('renders the follow option with an empty custom input for a null value', () => {
    render(<AgentLanguageField value={null} onChange={() => {}} {...props} />)

    expect(screen.getByRole('button', { name: 'Reply language preset' })).toHaveTextContent(
      'Follow conversation language'
    )
    expect(screen.getByRole('textbox', { name: 'Custom reply language' })).toHaveValue('')
  })

  it('commits a trimmed custom label on blur', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<AgentLanguageField value={null} onChange={onChange} {...props} />)

    await user.type(screen.getByRole('textbox', { name: 'Custom reply language' }), ' Thai ')
    await user.tab()

    expect(onChange).toHaveBeenCalledWith('Thai')
  })

  it('shows an inline error and withholds onChange for an overlong label', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<AgentLanguageField value={null} onChange={onChange} {...props} />)

    await user.type(screen.getByRole('textbox', { name: 'Custom reply language' }), 'a'.repeat(51))
    await user.tab()

    expect(screen.getByText('settings.agent.language.error.too_long')).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('commits null when the input is cleared', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<AgentLanguageField value="English" onChange={onChange} {...props} />)

    await user.clear(screen.getByRole('textbox', { name: 'Custom reply language' }))
    await user.tab()

    expect(onChange).toHaveBeenCalledWith(null)
  })

  it('commits the preset chosen from the searchable list', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<AgentLanguageField value={null} onChange={onChange} {...props} />)

    await user.click(screen.getByRole('button', { name: 'Reply language preset' }))
    await user.click(await screen.findByRole('option', { name: '日本語' }))

    expect(onChange).toHaveBeenCalledWith('日本語')
  })
})
