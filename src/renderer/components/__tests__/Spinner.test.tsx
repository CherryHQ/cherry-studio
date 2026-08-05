import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import Spinner from '../Spinner'

const { motionProps } = vi.hoisted(() => ({ motionProps: [] as Array<Record<string, unknown>> }))

vi.mock('motion/react', () => ({
  motion: {
    create: (Component: 'div') => (props: Record<string, unknown>) => {
      motionProps.push(props)
      return <Component {...props} />
    }
  }
}))

describe('Spinner', () => {
  it('animates between semantic foreground colors', () => {
    render(<Spinner text="Loading..." />)

    expect(motionProps.at(-1)?.variants).toEqual({
      defaultColor: { color: 'var(--foreground)' },
      dimmed: { color: 'var(--foreground-secondary)' }
    })
  })
})
