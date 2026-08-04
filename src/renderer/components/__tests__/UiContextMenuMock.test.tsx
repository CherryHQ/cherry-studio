import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger } from '@cherrystudio/ui'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

describe('@cherrystudio/ui ContextMenu test mock', () => {
  it('keeps uncontrolled content hidden until the trigger is opened', () => {
    const onSelect = vi.fn()

    render(
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <button type="button">Open menu</button>
        </ContextMenuTrigger>
        <ContextMenuContent>
          <ContextMenuItem onSelect={onSelect}>Rename</ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    )

    expect(screen.queryByText('Rename')).not.toBeInTheDocument()

    fireEvent.contextMenu(screen.getByRole('button', { name: 'Open menu' }))

    fireEvent.click(screen.getByText('Rename'))
    expect(onSelect).toHaveBeenCalledOnce()
    expect(screen.queryByText('Rename')).not.toBeInTheDocument()
  })
})
