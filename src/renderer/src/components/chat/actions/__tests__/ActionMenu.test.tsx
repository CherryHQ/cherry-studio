import { act, fireEvent, render, screen } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { ContextMenu, ContextMenuTrigger } from '../../primitives'
import { ActionConfirmDialog } from '../ActionConfirmDialog'
import { ActionMenu } from '../ActionMenu'
import type { ResolvedAction } from '../actionTypes'

vi.mock('@cherrystudio/ui', async () => {
  const React = await import('react')
  const itemHandler = (onSelect: ((event: any) => void) | undefined, props: Record<string, unknown>) => ({
    ...props,
    'data-disabled': props.disabled ? '' : undefined,
    disabled: props.disabled as boolean | undefined,
    onClick: (event: any) => onSelect?.(event),
    type: 'button'
  })

  return {
    ConfirmDialog: ({ cancelText, confirmText, description, onConfirm, open, title }: any) =>
      open
        ? React.createElement(
            'div',
            { role: 'dialog' },
            React.createElement('h2', null, title),
            description ? React.createElement('p', null, description) : null,
            React.createElement('button', { type: 'button' }, cancelText ?? 'Cancel'),
            React.createElement('button', { onClick: onConfirm, type: 'button' }, confirmText ?? 'Confirm')
          )
        : null,
    ContextMenu: ({ children }: any) => React.createElement('div', null, children),
    ContextMenuContent: ({ children, ...props }: any) => React.createElement('div', props, children),
    ContextMenuItem: ({ children, onSelect, ...props }: any) =>
      React.createElement('button', itemHandler(onSelect, props), children),
    ContextMenuSeparator: (props: any) => React.createElement('hr', props),
    ContextMenuShortcut: ({ children, ...props }: any) => React.createElement('span', props, children),
    ContextMenuSub: ({ children }: any) => React.createElement('div', null, children),
    ContextMenuSubContent: ({ children, ...props }: any) => React.createElement('div', props, children),
    ContextMenuSubTrigger: ({ children, ...props }: any) => React.createElement('button', props, children),
    ContextMenuTrigger: ({ children }: any) => React.createElement('div', null, children)
  }
})

const enabled = { visible: true, enabled: true }
const disabled = { visible: true, enabled: false, reason: 'Unavailable' }

function renderMenu(
  actions: ResolvedAction[],
  onAction = vi.fn(),
  props?: Pick<ComponentProps<typeof ActionMenu>, 'onConfirmActionComplete'>
) {
  render(
    <ContextMenu>
      <ContextMenuTrigger>Trigger</ContextMenuTrigger>
      <ActionMenu actions={actions} onAction={onAction} {...props} />
    </ContextMenu>
  )
  return onAction
}

describe('ActionMenu', () => {
  it('renders normal, disabled, danger, shortcut, and submenu actions', () => {
    renderMenu([
      {
        id: 'copy',
        label: 'Copy',
        shortcut: '⌘C',
        danger: false,
        availability: enabled,
        children: []
      },
      {
        id: 'delete',
        label: 'Delete',
        danger: true,
        availability: enabled,
        children: []
      },
      {
        id: 'disabled',
        label: 'Disabled',
        danger: false,
        availability: disabled,
        children: []
      },
      {
        id: 'more',
        label: 'More',
        danger: false,
        availability: enabled,
        children: [
          {
            id: 'nested',
            label: 'Nested',
            danger: false,
            availability: enabled,
            children: []
          }
        ]
      }
    ])

    expect(screen.getByText('Copy')).toBeInTheDocument()
    expect(screen.getByText('⌘C')).toBeInTheDocument()
    expect(screen.getByText('Delete')).toBeInTheDocument()
    expect(screen.getByText('Disabled').closest('[data-disabled]')).not.toBeNull()
    expect(screen.getByText('More')).toBeInTheDocument()
  })

  it('executes actions after confirmation', async () => {
    const onAction = renderMenu([
      {
        id: 'delete',
        label: 'Delete',
        danger: true,
        confirm: {
          title: 'Delete session?',
          confirmText: 'Delete',
          cancelText: 'Cancel',
          destructive: true
        },
        availability: enabled,
        children: []
      }
    ])

    fireEvent.click(screen.getByText('Delete'))
    expect(screen.getByText('Delete session?')).toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('dialog').querySelectorAll('button')[1])
    })
    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'delete' }))
  })

  it('notifies callers after a confirmed action completes', async () => {
    const onAction = vi.fn().mockResolvedValue(undefined)
    const onConfirmActionComplete = vi.fn()
    renderMenu(
      [
        {
          id: 'delete',
          label: 'Delete',
          danger: true,
          confirm: {
            title: 'Delete session?',
            confirmText: 'Delete',
            cancelText: 'Cancel',
            destructive: true
          },
          availability: enabled,
          children: []
        }
      ],
      onAction,
      { onConfirmActionComplete }
    )

    fireEvent.click(screen.getByText('Delete'))

    await act(async () => {
      fireEvent.click(screen.getByRole('dialog').querySelectorAll('button')[1])
    })

    expect(onAction).toHaveBeenCalledWith(expect.objectContaining({ id: 'delete' }))
    expect(onConfirmActionComplete).toHaveBeenCalledTimes(1)
  })
})

describe('ActionConfirmDialog', () => {
  it('renders caller-provided text and confirms', () => {
    const onConfirm = vi.fn()
    render(
      <ActionConfirmDialog
        open
        onOpenChange={vi.fn()}
        onConfirm={onConfirm}
        confirm={{
          title: 'Confirm title',
          description: 'Confirm description',
          confirmText: 'Run',
          cancelText: 'Cancel'
        }}
      />
    )

    expect(screen.getByText('Confirm title')).toBeInTheDocument()
    expect(screen.getByText('Confirm description')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Run' }))
    expect(onConfirm).toHaveBeenCalled()
  })
})
