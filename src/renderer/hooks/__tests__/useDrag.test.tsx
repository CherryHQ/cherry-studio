import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useDrag } from '../useDrag'

function DropTarget() {
  const { isDragging, handleDragOver, handleDragLeave } = useDrag<HTMLDivElement>()

  return (
    <div role="region" aria-label="Drop target" onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
      <output>{isDragging ? 'Drop files' : 'Idle'}</output>
      <span>Child</span>
    </div>
  )
}

describe('drag leave target boundary', () => {
  it('keeps drop feedback when entering a child', () => {
    render(<DropTarget />)
    const target = screen.getByRole('region', { name: 'Drop target' })
    fireEvent.dragOver(target)
    expect(screen.getByRole('status')).toHaveTextContent('Drop files')

    fireEvent(target, new MouseEvent('dragleave', { bubbles: true, relatedTarget: screen.getByText('Child') }))

    expect(screen.getByRole('status')).toHaveTextContent('Drop files')
  })

  it('clears drop feedback when the related target is a window', () => {
    render(<DropTarget />)
    const target = screen.getByRole('region', { name: 'Drop target' })
    fireEvent.dragOver(target)

    const frame = document.createElement('iframe')
    document.body.append(frame)

    try {
      fireEvent(target, new MouseEvent('dragleave', { bubbles: true, relatedTarget: frame.contentWindow }))
      expect(screen.getByRole('status')).toHaveTextContent('Idle')
    } finally {
      frame.remove()
    }
  })
})
