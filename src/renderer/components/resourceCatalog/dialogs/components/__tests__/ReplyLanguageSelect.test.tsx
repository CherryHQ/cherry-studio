// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import { ReplyLanguageSelect } from '../ReplyLanguageSelect'

vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal<typeof CherryStudioUi>())

afterEach(() => {
  cleanup()
  MockUsePreferenceUtils.resetMocks()
})

describe('ReplyLanguageSelect', () => {
  it.each([
    ['  Português  ', { languageMode: 'custom', languageCustom: 'Português' }],
    ['', { languageMode: 'inherit', languageCustom: '' }]
  ])('commits a custom-language edit only on blur (%s)', (text, expected) => {
    const save = vi.fn()
    render(<ReplyLanguageSelect value={{ languageMode: 'custom', languageCustom: 'Svenska' }} onChange={save} />)

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: text } })
    expect(save).not.toHaveBeenCalled()
    fireEvent.blur(input)
    expect(save.mock.calls).toEqual([[expected]])
  })

  it('previews a draft without replacing the saved override with an invalid edit', () => {
    const save = vi.fn()
    const preview = vi.fn()
    render(
      <ReplyLanguageSelect
        value={{ languageMode: 'custom', languageCustom: 'Svenska' }}
        onChange={save}
        onDraftChange={preview}
      />
    )

    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Po' } })
    expect(preview).toHaveBeenLastCalledWith('Po')
    expect(save).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: 'Po\u2028rtuguês' } })
    fireEvent.blur(input)
    expect(input).toHaveValue('Svenska')
    expect(preview).toHaveBeenLastCalledWith(undefined)
    expect(save).not.toHaveBeenCalled()
  })

  it('shows the global language on the follow-global option', () => {
    MockUsePreferenceUtils.setPreferenceValue('agent.language', '日本語')
    render(<ReplyLanguageSelect value={{ languageMode: 'inherit', languageCustom: '' }} onChange={() => {}} />)

    expect(screen.getByRole('combobox')).toHaveTextContent('日本語')
  })

  it('opens on the input for a stored language that is not a preset', () => {
    render(<ReplyLanguageSelect value={{ languageMode: 'custom', languageCustom: 'Svenska' }} onChange={() => {}} />)

    expect(screen.getByRole('textbox')).toHaveValue('Svenska')
  })

  // The stored value can change in another window while this one is open.
  it('shows a preset language set elsewhere instead of staying on Other', () => {
    const { rerender } = render(
      <ReplyLanguageSelect value={{ languageMode: 'custom', languageCustom: 'Svenska' }} onChange={() => {}} />
    )

    rerender(<ReplyLanguageSelect value={{ languageMode: 'custom', languageCustom: 'English' }} onChange={() => {}} />)

    expect(screen.getByRole('combobox')).toHaveTextContent('English')
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
