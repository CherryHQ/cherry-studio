// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { type ComponentPropsWithoutRef, createElement } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@renderer/components/Avatar/ModelAvatar', () => ({
  default: ({ size }: { size: number }) => <span data-size={size} data-testid="model-avatar" />
}))

import { DialogModelTrigger } from '../DialogFormFields'

afterEach(() => {
  cleanup()
})

describe('DialogModelTrigger', () => {
  it('passes trigger props through to the underlying button for asChild popovers', () => {
    const onClick = vi.fn()
    const Trigger = DialogModelTrigger as unknown as (
      props: ComponentPropsWithoutRef<'button'> & ComponentPropsWithoutRef<typeof DialogModelTrigger>
    ) => ReturnType<typeof DialogModelTrigger>

    render(createElement(Trigger, { ariaLabel: 'Model', displayLabel: 'Pick model', onClick }))

    const trigger = screen.getByRole('button', { name: 'Model' })

    expect(trigger).toHaveClass('h-8', 'rounded-md', 'gap-2', 'border-input', 'bg-background', 'text-sm')
    expect(screen.queryByTestId('model-trigger-placeholder')).not.toBeInTheDocument()
    expect(screen.queryByTestId('model-avatar')).not.toBeInTheDocument()

    fireEvent.click(trigger)

    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
