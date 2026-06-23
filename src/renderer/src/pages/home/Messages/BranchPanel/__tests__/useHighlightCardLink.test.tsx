import { fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useHighlightCardLink } from '../useHighlightCardLink'

// A harness that mirrors the real DOM relationship: source-passage spans on the
// "main thread" side and a card on the "panel" side, both under one container
// (the #chat ancestor). Asserts the bidirectional linkage the hook drives.
function Harness({ onActivate = vi.fn() }: { onActivate?: (id: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const { hoveredBranchId, handleCardMouseEnter, handleCardMouseLeave } = useHighlightCardLink({
    containerRef,
    onActivateBranch: onActivate
  })
  return (
    <div ref={containerRef} data-testid="root">
      <p>
        prefix{' '}
        <span className="branch-anchor-highlight" data-branch-id="X" data-hl="c1" data-testid="span-x">
          passage
        </span>{' '}
        suffix
      </p>
      <div data-testid="branch-pane-scroll">
        <span className="branch-anchor-highlight" data-branch-id="Y" data-hl="c2" data-testid="span-y-in-panel">
          y
        </span>
        <button
          type="button"
          data-testid="card-x"
          onMouseEnter={() => handleCardMouseEnter('X')}
          onMouseLeave={handleCardMouseLeave}>
          card X
        </button>
      </div>
      <output data-testid="hovered">{hoveredBranchId ?? ''}</output>
    </div>
  )
}

afterEach(() => {
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('useHighlightCardLink (P1-S2d card↔highlight linkage)', () => {
  it('card hover emphasises the matching source span and sets hoveredBranchId; leaving clears both', () => {
    render(<Harness />)
    const spanX = screen.getByTestId('span-x')

    fireEvent.mouseEnter(screen.getByTestId('card-x'))
    expect(spanX.classList.contains('is-emphasized')).toBe(true)
    expect(screen.getByTestId('hovered')).toHaveTextContent('X')

    fireEvent.mouseLeave(screen.getByTestId('card-x'))
    expect(spanX.classList.contains('is-emphasized')).toBe(false)
    expect(screen.getByTestId('hovered').textContent).toBe('')
  })

  it('hovering a source span (main thread) emphasises it and sets hoveredBranchId; moving off clears it', () => {
    render(<Harness />)
    const spanX = screen.getByTestId('span-x')

    fireEvent.mouseOver(spanX)
    expect(screen.getByTestId('hovered')).toHaveTextContent('X')
    expect(spanX.classList.contains('is-emphasized')).toBe(true)

    // Moving onto non-span area clears.
    fireEvent.mouseOver(screen.getByTestId('root'))
    expect(screen.getByTestId('hovered').textContent).toBe('')
    expect(spanX.classList.contains('is-emphasized')).toBe(false)
  })

  it('clicking a source span calls onActivateBranch with its branch id', () => {
    const onActivate = vi.fn()
    render(<Harness onActivate={onActivate} />)

    fireEvent.click(screen.getByTestId('span-x'))
    expect(onActivate).toHaveBeenCalledExactlyOnceWith('X')
  })

  it('ignores spans inside the branch panel for the highlight→card direction (cards own that)', () => {
    const onActivate = vi.fn()
    render(<Harness onActivate={onActivate} />)

    fireEvent.mouseOver(screen.getByTestId('span-y-in-panel'))
    fireEvent.click(screen.getByTestId('span-y-in-panel'))

    expect(screen.getByTestId('hovered').textContent).toBe('')
    expect(screen.getByTestId('span-y-in-panel').classList.contains('is-emphasized')).toBe(false)
    expect(onActivate).not.toHaveBeenCalled()
  })
})
