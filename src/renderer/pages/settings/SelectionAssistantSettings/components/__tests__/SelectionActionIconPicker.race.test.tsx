import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const gate = vi.hoisted(() => {
  let release: () => void = () => {}
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release: () => release() }
})

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key })
}))
vi.mock('@cherrystudio/ui', async (importOriginal) => importOriginal())
// The icon list loads only once the gate opens, so a dice roll stays pending while the user chooses again.
vi.mock('lucide-react/dynamic', async () => {
  await gate.promise
  return {
    DynamicIcon: ({ name }: { name: string }) => <svg data-testid={`icon-${name}`} />,
    iconNames: ['heart', 'house']
  }
})

import SelectionActionIconPicker from '../SelectionActionIconPicker'

beforeAll(() => {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
})

afterEach(cleanup)

describe('SelectionActionIconPicker pending dice roll', () => {
  it('does not overwrite a newer choice made while the roll is loading', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<SelectionActionIconPicker value="languages" onChange={onChange} />)

    await user.click(screen.getByRole('button', { name: 'selection.settings.user_modal.icon.random' }))
    await user.click(screen.getByRole('button', { name: 'languages' }))
    await user.click(await screen.findByRole('button', { name: 'selection.settings.user_modal.icon.default' }))
    expect(onChange).toHaveBeenLastCalledWith('')

    gate.release()
    await new Promise((resolve) => setTimeout(resolve, 20))

    await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1))
    expect(onChange).toHaveBeenLastCalledWith('')
  })
})
