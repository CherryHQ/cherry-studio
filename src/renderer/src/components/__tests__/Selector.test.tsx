import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import Selector from '../Selector'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, params?: { count?: number }) => {
      if (key === 'common.selectedItems') {
        return `${params?.count ?? 0} selected`
      }
      return key
    }
  })
}))

describe('Selector', () => {
  it('renders the selected single option and emits the original option value', async () => {
    const onChange = vi.fn()

    render(
      <Selector
        value={1}
        onChange={onChange}
        options={[
          { label: 'One', value: 1 },
          { label: 'Two', value: 2 }
        ]}
      />
    )

    expect(screen.getByRole('combobox', { name: /one/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('option', { name: /two/i }))

    expect(onChange).toHaveBeenCalledWith(2)
  })

  it('keeps multiple selections open and toggles values', async () => {
    const onChange = vi.fn()

    render(
      <Selector
        multiple
        value={['en-US', 'zh-CN']}
        onChange={onChange}
        placeholder="Languages"
        options={[
          { label: 'English', value: 'en-US' },
          { label: 'Chinese', value: 'zh-CN' },
          { label: 'French', value: 'fr-FR' }
        ]}
      />
    )

    expect(screen.getByRole('combobox', { name: /2 selected/i })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('option', { name: /french/i }))

    expect(onChange).toHaveBeenCalledWith(['en-US', 'zh-CN', 'fr-FR'])
  })

  it('does not emit changes when disabled', async () => {
    const onChange = vi.fn()

    render(
      <Selector
        disabled
        value="plain"
        onChange={onChange}
        options={[
          { label: 'Plain', value: 'plain' },
          { label: 'Bubble', value: 'bubble' }
        ]}
      />
    )

    expect(screen.getByRole('combobox', { name: /plain/i })).toHaveAttribute('aria-disabled', 'true')

    await userEvent.click(screen.getByRole('option', { name: /bubble/i }))

    expect(onChange).not.toHaveBeenCalled()
  })

  it('supports ReactNode labels in the trigger', () => {
    render(
      <Selector
        value="system"
        onChange={vi.fn()}
        options={[
          {
            value: 'system',
            label: (
              <span>
                <span aria-hidden>EN</span>
                System
              </span>
            )
          }
        ]}
      />
    )

    expect(screen.getByRole('combobox', { name: /system/i })).toBeInTheDocument()
  })
})
