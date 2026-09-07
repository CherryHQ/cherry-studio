import { Form, FormField, FormItem } from '@cherrystudio/ui'
import type { PermissionMode } from '@renderer/types/agent'
import { fireEvent, render, screen } from '@testing-library/react'
import type { TFunction } from 'i18next'
import { useForm } from 'react-hook-form'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import * as PermissionModeComponents from '../PermissionModeOption'
import { QuickPanelRow } from '../QuickPanel/list'

vi.mock('@cherrystudio/ui', () => vi.importActual('@cherrystudio/ui'))

const { PermissionModeIcon, PermissionModeOptionLabel, PermissionModeSelect, PermissionModeWarning } =
  PermissionModeComponents

// The component only ever calls t(key, fallback); rendering the fallback keeps these
// assertions about layout rather than about the locale files.
const t = ((_key: string, fallback?: string) => fallback ?? '') as unknown as TFunction

const withWarning = {
  mode: 'auto' as const,
  titleKey: 'title.key',
  titleFallback: 'Approve for Me',
  descriptionKey: 'description.key',
  descriptionFallback: 'Runs without routine prompts.',
  warningKey: 'warning.key',
  warningFallback: 'Needs a model that supports it.'
}

const withoutWarning = {
  mode: 'default' as const,
  titleKey: 'title.key',
  titleFallback: 'Ask Before Acting',
  descriptionKey: 'description.key',
  descriptionFallback: 'Asks before editing files.'
}

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver

  if (!HTMLElement.prototype.hasPointerCapture) HTMLElement.prototype.hasPointerCapture = () => false
  if (!HTMLElement.prototype.releasePointerCapture) HTMLElement.prototype.releasePointerCapture = () => {}
  if (!HTMLElement.prototype.setPointerCapture) HTMLElement.prototype.setPointerCapture = () => {}
  HTMLElement.prototype.scrollIntoView = () => {}
})

function PermissionSelectHarness({ onValueChange }: { onValueChange?: (value: PermissionMode) => void }) {
  const form = useForm<{ permissionMode: PermissionMode }>({ defaultValues: { permissionMode: 'default' } })

  return (
    <Form {...form}>
      <form>
        <FormField
          control={form.control}
          name="permissionMode"
          render={({ field }) => (
            <FormItem>
              <PermissionModeSelect
                cards={[withoutWarning, withWarning]}
                value={field.value}
                onValueChange={(value) => {
                  field.onChange(value)
                  onValueChange?.(value)
                }}
                portalContainer={document.body}
                ariaLabel="Permission mode"
                t={t}
              />
            </FormItem>
          )}
        />
      </form>
    </Form>
  )
}

function renderOpenPermissionSelect() {
  render(<PermissionSelectHarness />)

  const trigger = screen.getByRole('combobox', { name: 'Permission mode' })
  fireEvent.pointerDown(trigger)
  fireEvent.click(trigger)
}

describe('PermissionModeIcon', () => {
  it('marks only Full Access as a custom destructive toolbar icon', () => {
    const { container, rerender } = render(<PermissionModeIcon mode="default" />)
    const defaultIcon = container.querySelector('svg')

    expect(defaultIcon).toHaveClass('text-muted-foreground')
    expect(defaultIcon).not.toHaveClass('lucide-custom')

    rerender(<PermissionModeIcon mode="bypassPermissions" />)
    const fullAccessIcon = container.querySelector('svg')

    expect(fullAccessIcon).toHaveClass('text-destructive', 'lucide-custom')
  })
})

describe('PermissionModeOptionLabel', () => {
  it('keeps permanent copy to the title and optional description', () => {
    render(<PermissionModeOptionLabel card={withWarning} t={t} />)

    expect(screen.getByText('Approve for Me')).toBeInTheDocument()
    expect(screen.getByText('Runs without routine prompts.')).toBeInTheDocument()
    expect(screen.queryByText('Needs a model that supports it.')).not.toBeInTheDocument()
  })

  it('supports compact title-only surfaces', () => {
    render(<PermissionModeOptionLabel card={withWarning} t={t} withDescription={false} />)

    expect(screen.getByText('Approve for Me')).toBeInTheDocument()
    expect(screen.queryByText('Runs without routine prompts.')).not.toBeInTheDocument()
    expect(screen.queryByText('Needs a model that supports it.')).not.toBeInTheDocument()
  })
})

describe('PermissionModeSelect', () => {
  it('keeps the long warning out of permanent option copy and exposes it on pointer hover', async () => {
    renderOpenPermissionSelect()

    const option = await screen.findByRole('option', { name: /Approve for Me/ })
    expect(option).not.toHaveTextContent('Needs a model that supports it.')

    fireEvent.pointerMove(option, { pointerType: 'mouse' })

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Needs a model that supports it.')
  })

  it('exposes the warning when keyboard focus reaches the option', async () => {
    renderOpenPermissionSelect()

    const option = await screen.findByRole('option', { name: /Approve for Me/ })
    const matches = vi.spyOn(option, 'matches').mockImplementation((selector) => selector === ':focus-visible')

    try {
      fireEvent.focus(option)
      expect(await screen.findByRole('tooltip')).toHaveTextContent('Needs a model that supports it.')
      expect(option).toHaveAttribute('aria-describedby')
    } finally {
      matches.mockRestore()
    }
  })
})

describe('PermissionModeWarning', () => {
  it('reveals a compact warning trigger on pointer hover', async () => {
    render(<PermissionModeWarning card={withWarning} t={t} />)

    const trigger = screen.getByLabelText('Needs a model that supports it.')
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    fireEvent.pointerMove(trigger, { pointerType: 'mouse' })

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Needs a model that supports it.')
  })

  it('keeps the warning in the QuickPanel row accessible name', () => {
    render(
      <QuickPanelRow
        active
        item={{
          id: 'permission-mode-auto',
          label: <PermissionModeOptionLabel card={withWarning} t={t} withDescription={false} />,
          description: 'Runs without routine prompts.',
          icon: '!',
          tooltip: 'Needs a model that supports it.',
          tooltipAnchor: <PermissionModeWarning card={withWarning} showTooltip={false} t={t} />
        }}
        onSelect={vi.fn()}
      />
    )

    expect(screen.getByRole('button', { name: /Needs a model that supports it\./ })).toBeInTheDocument()
  })

  it('anchors the keyboard-active QuickPanel warning Tooltip to its icon', async () => {
    const item = {
      id: 'permission-mode-auto',
      label: 'Approve for Me',
      description: 'Runs without routine prompts.',
      icon: '!',
      tooltip: 'Needs a model that supports it.',
      tooltipAnchor: <PermissionModeWarning card={withWarning} showTooltip={false} t={t} />
    }
    const { rerender } = render(<QuickPanelRow active item={item} onSelect={vi.fn()} />)

    // Programmatic focus (e.g. the panel opens on the current value) does not surface the tooltip.
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument()

    rerender(<QuickPanelRow active keyboardActive item={item} onSelect={vi.fn()} />)

    const tooltip = await screen.findByRole('tooltip')
    const icon = screen.getByLabelText('Needs a model that supports it.')
    const trigger = document.querySelector(`[aria-describedby="${tooltip.id}"]`)

    expect(tooltip).toHaveTextContent('Needs a model that supports it.')
    expect(trigger).toContainElement(icon)
    expect(screen.getByRole('button')).not.toHaveAttribute('aria-describedby')
  })

  it('opens the anchored QuickPanel warning Tooltip from icon hover', async () => {
    render(
      <QuickPanelRow
        active={false}
        item={{
          id: 'permission-mode-auto',
          label: 'Approve for Me',
          description: 'Runs without routine prompts.',
          icon: '!',
          tooltip: 'Needs a model that supports it.',
          tooltipAnchor: <PermissionModeWarning card={withWarning} showTooltip={false} t={t} />
        }}
        onSelect={vi.fn()}
      />
    )

    fireEvent.pointerMove(screen.getByLabelText('Needs a model that supports it.'), { pointerType: 'mouse' })

    expect(await screen.findByRole('tooltip')).toHaveTextContent('Needs a model that supports it.')
  })
})

describe('PermissionModeSelect', () => {
  it('ignores a transient empty value from the native select', () => {
    const onValueChange = vi.fn()
    render(<PermissionSelectHarness onValueChange={onValueChange} />)

    expect(screen.getByRole('combobox', { name: 'Permission mode' })).toHaveTextContent('Ask Before Acting')

    const nativeSelect = document.querySelector('select')
    expect(nativeSelect).not.toBeNull()
    fireEvent.change(nativeSelect as HTMLSelectElement, { target: { value: '' } })
    expect(onValueChange).not.toHaveBeenCalled()

    fireEvent.change(nativeSelect as HTMLSelectElement, { target: { value: 'auto' } })
    expect(onValueChange).toHaveBeenCalledWith('auto')
  })
})
