import { FC, useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

export interface TableAction {
  label: string
  action: () => void
  icon?: string
}

export interface TableActionMenuProps {
  show: boolean
  position?: { x: number; y: number }
  actions: TableAction[]
  onClose: () => void
}

export const TableActionMenu: FC<TableActionMenuProps> = ({ show, position, actions, onClose }) => {
  const menuRef = useRef<HTMLDivElement>(null)
  const [menuPosition, setMenuPosition] = useState(position || { x: 0, y: 0 })

  useEffect(() => {
    if (show && position) {
      setMenuPosition(position)
    }
  }, [show, position])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        onClose()
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    if (show) {
      document.addEventListener('mousedown', handleClickOutside)
      document.addEventListener('keydown', handleEscape)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [show, onClose])

  const handleActionClick = useCallback(
    (action: TableAction) => {
      action.action()
      onClose()
    },
    [onClose]
  )

  if (!show) return null

  const menu = (
    <div
      ref={menuRef}
      className="table-action-menu"
      style={{
        position: 'fixed',
        left: menuPosition.x,
        top: menuPosition.y,
        zIndex: 1000,
        backgroundColor: 'var(--color-bg-base)',
        border: '1px solid var(--color-border)',
        borderRadius: '4px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.15)',
        minWidth: '160px',
        padding: '4px 0'
      }}>
      {actions.map((action, index) => (
        <button
          key={index}
          type="button"
          className="table-action-item"
          onClick={() => handleActionClick(action)}
          style={{
            width: '100%',
            border: 'none',
            background: 'none',
            padding: '8px 16px',
            textAlign: 'left',
            cursor: 'pointer',
            fontSize: '14px',
            color: 'var(--color-text)',
            transition: 'background-color 0.2s',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)'
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent'
          }}>
          {action.icon && <span>{action.icon}</span>}
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  )

  return createPortal(menu, document.body)
}
