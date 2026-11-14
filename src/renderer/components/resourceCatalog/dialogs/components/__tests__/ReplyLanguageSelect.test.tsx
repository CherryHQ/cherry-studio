// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { MockUsePreferenceUtils } from '@test-mocks/renderer/usePreference'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as CherryStudioUi from '@cherrystudio/ui'

import { ReplyLanguageSelect } from '../ReplyLanguageSelect'

vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal<typeof CherryStudioUi>())

afterEach(() => {
  cleanup()
  MockUsePreferenceUtils.resetMocks()
})

describe('ReplyLanguageSelect', () => {
  it('shows the global language on the follow-global option', () => {
    MockUsePreferenceUtils.setPreferenceValue('agent.language', '日本語')
    render(<ReplyLanguageSelect value={{ languageMode: 'inherit', languageCustom: '' }} onChange={() => {}} />)

    expect(screen.getByRole('combobox')).toHaveTextContent('日本語')
  })

  it('opens on the input for a stored language that is not a preset', () => {
    render(<ReplyLanguageSelect value={{ languageMode: 'custom', languageCustom: 'Svenska' }} onChange={() => {}} />)

    expect(screen.getByRole('textbox')).toHaveValue('Svenska')
  })
})
