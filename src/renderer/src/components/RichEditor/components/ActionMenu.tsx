import { Menu } from 'antd'
import React, { FC, useCallback, useEffect, useMemo, useRef } from 'react'
import { createPortal } from 'react-dom'

export interface ActionMenuItem {
  key: string
  label: React.ReactNode
  icon?: React.ReactNode
  danger?: boolean
  onClick: () => void
}

export interface ActionMenuProps {
  show: boolean
  position: { x: number; y: number }
  items: ActionMenuItem[]
  onClose: () => void
  minWidth?: number
}

export const ActionMenu: FC<ActionMenuProps> = ({ show, position, items, onClose, minWidth = 168 }) => {
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!show) return
    const onDocMouseDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('mousedown', onDocMouseDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [show, onClose])

  const menuItems = useMemo(
    () =>
      items.map((it) => ({
        key: it.key,
        label: it.label,
        icon: it.icon,
        danger: it.danger
      })),
    [items]
  )

  const onMenuClick = useCallback(
    ({ key }: { key: string }) => {
      const found = items.find((i) => i.key === key)
      if (found) found.onClick()
      onClose()
    },
    [items, onClose]
  )

  if (!show) return null

  const node = (
    <div
      ref={ref}
      style={{
        position: 'fixed',
        left: position.x,
        top: position.y,
        zIndex: 2000,
        background: 'var(--color-bg-base)',
        border: '1px solid var(--color-border)',
        borderRadius: 6,
        boxShadow: '0 6px 16px rgba(0,0,0,0.12)',
        overflow: 'hidden',
        minWidth
      }}>
      <Menu selectable={false} items={menuItems} onClick={onMenuClick} style={{ border: 'none' }} />
    </div>
  )

  return createPortal(node, document.body)
}
