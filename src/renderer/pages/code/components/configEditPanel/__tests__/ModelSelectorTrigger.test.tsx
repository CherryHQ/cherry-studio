import { fireEvent, render, screen } from '@testing-library/react'
import { useEffect, useRef } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ModelSelectorTrigger } from '../ModelSelectorTrigger'

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: () => <span data-testid="model-avatar" />
}))

vi.mock('@renderer/hooks/useModel', () => ({
  useModelById: () => ({ model: undefined })
}))

describe('ModelSelectorTrigger', () => {
  it('forwards trigger props and ref to the underlying button', () => {
    const onClick = vi.fn()
    let triggerRef: HTMLButtonElement | null = null

    function TriggerHarness() {
      const ref = useRef<HTMLButtonElement>(null)

      useEffect(() => {
        triggerRef = ref.current
      }, [])

      return (
        <ModelSelectorTrigger
          ref={ref}
          placeholder="settings.models.empty"
          data-testid="model-selector-trigger"
          data-state="open"
          aria-expanded="true"
          onClick={onClick}
        />
      )
    }

    render(<TriggerHarness />)

    const trigger = screen.getByTestId('model-selector-trigger')

    expect(triggerRef).toBe(trigger)
    expect(trigger).toHaveAttribute('data-state', 'open')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('settings.models.empty')).toBeInTheDocument()

    fireEvent.click(trigger)

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
