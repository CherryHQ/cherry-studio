import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TopicGroupNameDialog } from '../TopicGroupNameDialog'

type Settle = { resolve: () => void; reject: (error: Error) => void }

function setup() {
  const settles: Settle[] = []
  const onSubmit = vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        settles.push({ resolve, reject })
      })
  )
  const onOpenChange = vi.fn()
  const props = { title: 'T', submitLabel: 'Save', onSubmit, onOpenChange }
  const view = render(<TopicGroupNameDialog {...props} open initialName="First" />)
  return { settles, onOpenChange, view, props }
}

const submit = () => fireEvent.submit(screen.getByRole('textbox').closest('form') as HTMLFormElement)

describe('TopicGroupNameDialog stale saves', () => {
  it('does not close a replacement draft when the previous save succeeds late', async () => {
    const { settles, onOpenChange, view, props } = setup()
    submit()
    view.rerender(<TopicGroupNameDialog {...props} open={false} initialName="First" />)
    view.rerender(<TopicGroupNameDialog {...props} open initialName="Second" />)

    await act(async () => settles[0].resolve())

    expect(onOpenChange).not.toHaveBeenCalledWith(false)
    expect(screen.getByRole('textbox')).toHaveValue('Second')
  })

  it('does not show a previous failure in a replacement draft', async () => {
    const { settles, view, props } = setup()
    submit()
    view.rerender(<TopicGroupNameDialog {...props} open={false} initialName="First" />)
    view.rerender(<TopicGroupNameDialog {...props} open initialName="Second" />)

    await act(async () => settles[0].reject(new Error('stale failure')))

    expect(screen.queryByText(/stale failure/)).toBeNull()
  })

  it('closes the dialog when the current draft saves', async () => {
    const { settles, onOpenChange } = setup()
    submit()
    await act(async () => settles[0].resolve())
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })
})
