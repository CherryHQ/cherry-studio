import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ModelContextWindowFields } from '../ModelContextWindowFields'

vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<object>()

  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key })
  }
})

// The add form supplies no commit callbacks, so the normalized value reaches
// the field only through the change callbacks.
function AddFormFields({ onContextWindowChange }: { onContextWindowChange: (value: number | null) => void }) {
  const [contextWindow, setContextWindow] = useState<number | null>(null)

  return (
    <ModelContextWindowFields
      contextWindow={contextWindow}
      maxInputTokens={null}
      maxOutputTokens={null}
      onContextWindowChange={(value) => {
        setContextWindow(value)
        onContextWindowChange(value)
      }}
      onMaxInputTokensChange={vi.fn()}
      onMaxOutputTokensChange={vi.fn()}
    />
  )
}

describe('ModelContextWindowFields', () => {
  it('settles a decimal into an integer even without a commit callback', async () => {
    const user = userEvent.setup()
    const onContextWindowChange = vi.fn()
    render(<AddFormFields onContextWindowChange={onContextWindowChange} />)

    const input = screen.getByLabelText('settings.models.add.context_window.label')
    await user.type(input, '3.9')
    await user.tab()

    expect(input).toHaveValue('3')
    expect(onContextWindowChange).toHaveBeenLastCalledWith(3)
  })

  it('raises a value below the minimum on blur', async () => {
    const user = userEvent.setup()
    const onContextWindowChange = vi.fn()
    render(<AddFormFields onContextWindowChange={onContextWindowChange} />)

    const input = screen.getByLabelText('settings.models.add.context_window.label')
    await user.type(input, '0')
    await user.tab()

    expect(input).toHaveValue('1')
    expect(onContextWindowChange).toHaveBeenLastCalledWith(1)
  })

  it('does not clear a saved limit when the edit ends on an incomplete number', async () => {
    const user = userEvent.setup()
    const onContextWindowCommit = vi.fn()

    function ExistingFields() {
      const [contextWindow, setContextWindow] = useState<number | null>(128_000)
      return (
        <ModelContextWindowFields
          contextWindow={contextWindow}
          maxInputTokens={null}
          maxOutputTokens={null}
          onContextWindowChange={setContextWindow}
          onContextWindowCommit={onContextWindowCommit}
          onMaxInputTokensChange={vi.fn()}
          onMaxOutputTokensChange={vi.fn()}
        />
      )
    }

    render(<ExistingFields />)
    const input = screen.getByLabelText('settings.models.add.context_window.label')
    await user.clear(input)
    await user.type(input, '1e')
    await user.tab()

    expect(onContextWindowCommit).toHaveBeenCalledExactlyOnceWith(128_000)
    expect(input).toHaveValue('128000')
  })
})
