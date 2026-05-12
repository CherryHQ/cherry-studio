import { fireEvent, render, screen } from '@testing-library/react'
import type { HTMLAttributes, ReactNode, RefObject } from 'react'
import { useEffect, useState } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ChatAppShell } from '../ChatAppShell'

vi.mock('@renderer/utils', () => ({
  cn: (...inputs: unknown[]) => inputs.filter(Boolean).join(' ')
}))

type MotionDivProps = HTMLAttributes<HTMLDivElement> & {
  animate?: unknown
  exit?: unknown
  initial?: unknown
  layout?: unknown
  ref?: RefObject<HTMLDivElement | null>
  transition?: unknown
}

vi.mock('motion/react', () => {
  return {
    AnimatePresence: ({ children }: { children: ReactNode }) => children,
    motion: {
      div: ({ ref, children, ...props }: MotionDivProps) => {
        const domProps = { ...props }
        delete domProps.animate
        delete domProps.exit
        delete domProps.initial
        delete domProps.layout
        delete domProps.transition

        return (
          <div ref={ref} {...domProps}>
            {children}
          </div>
        )
      }
    }
  }
})

describe('ChatAppShell', () => {
  it('keeps the pane mounted when keyed center content changes', () => {
    const paneMounts: string[] = []

    function Pane() {
      const [count, setCount] = useState(0)

      useEffect(() => {
        paneMounts.push('mounted')
      }, [])

      return (
        <button type="button" onClick={() => setCount((value) => value + 1)}>
          pane count {count}
        </button>
      )
    }

    const { rerender } = render(
      <ChatAppShell
        pane={<Pane />}
        paneOpen
        centerContent={<div key="topic-1">topic 1 content</div>}
        topBar={<div>topic 1 nav</div>}
      />
    )

    fireEvent.click(screen.getByRole('button', { name: 'pane count 0' }))

    expect(screen.getByRole('button', { name: 'pane count 1' })).toBeInTheDocument()

    rerender(
      <ChatAppShell
        pane={<Pane />}
        paneOpen
        centerContent={<div key="topic-2">topic 2 content</div>}
        topBar={<div>topic 2 nav</div>}
      />
    )

    expect(screen.getByRole('button', { name: 'pane count 1' })).toBeInTheDocument()
    expect(screen.queryByText('topic 1 content')).not.toBeInTheDocument()
    expect(screen.getByText('topic 2 content')).toBeInTheDocument()
    expect(paneMounts).toEqual(['mounted'])
  })
})
