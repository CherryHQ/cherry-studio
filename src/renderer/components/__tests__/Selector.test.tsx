import type * as CherryStudioUi from '@cherrystudio/ui'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import Selector from '../Selector'

vi.mock('@cherrystudio/ui', async (importOriginal) => await importOriginal<typeof CherryStudioUi>())

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

vi.mock('@renderer/i18n/label', () => ({
  getProviderLabel: (id: string) => id
}))

vi.mock('@renderer/i18n/resolver', () => ({
  default: {
    t: (key: string) => key
  }
}))

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as any
  if (!HTMLElement.prototype.hasPointerCapture) {
    HTMLElement.prototype.hasPointerCapture = () => false
  }
  if (!HTMLElement.prototype.releasePointerCapture) {
    HTMLElement.prototype.releasePointerCapture = () => {}
  }
  if (!HTMLElement.prototype.setPointerCapture) {
    HTMLElement.prototype.setPointerCapture = () => {}
  }
  HTMLElement.prototype.scrollIntoView = () => {}
})

afterEach(cleanup)

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

    const trigger = screen.getByRole('combobox', { name: /one/i })
    expect(trigger).toHaveAttribute('data-slot', 'select-trigger')
    expect(trigger).toHaveClass(
      'justify-between',
      'rounded-lg',
      'border-input',
      'bg-transparent',
      'hover:border-border-strong',
      'hover:bg-transparent',
      'focus-visible:border-ring',
      'aria-expanded:bg-transparent',
      'dark:bg-transparent'
    )
    expect(trigger.querySelector('.grid')).toHaveClass('items-center')
    expect(trigger.querySelector('[data-slot="select-value"]')?.parentElement).toHaveClass('col-start-1', 'row-start-1')
    expect(trigger).not.toHaveClass('bg-accent')

    await userEvent.click(trigger)
    expect(trigger).not.toHaveClass('bg-accent')
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

    const trigger = screen.getByRole('combobox', { name: /2 selected/i })
    expect(trigger).toBeInTheDocument()

    await userEvent.click(trigger)
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

    const combobox = screen.getByRole('combobox', { name: /plain/i })
    expect(combobox).toBeDisabled()
    expect(combobox).toHaveAttribute('aria-expanded', 'false')

    await userEvent.click(combobox)

    // Disabled trigger ignores the click — popover stays closed and no value emits.
    expect(combobox).toHaveAttribute('aria-expanded', 'false')
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
