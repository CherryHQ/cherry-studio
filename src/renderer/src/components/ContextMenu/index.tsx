import { Dropdown } from 'antd'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface ContextMenuProps {
  children: React.ReactNode
  onContextMenu?: (e: React.MouseEvent) => void
}

const ContextMenu: React.FC<ContextMenuProps> = ({ children, onContextMenu }) => {
  const { t } = useTranslation()
  const [contextMenuPosition, setContextMenuPosition] = useState<{ x: number; y: number } | null>(null)
  const [selectedText, setSelectedText] = useState<string>('')

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      const _selectedText = window.getSelection()?.toString()
      if (_selectedText) {
        setContextMenuPosition({ x: e.clientX, y: e.clientY })
        setSelectedText(_selectedText)
      }
      onContextMenu?.(e)
    },
    [onContextMenu]
  )

  useEffect(() => {
    const handleClick = () => {
      setContextMenuPosition(null)
    }
    document.addEventListener('click', handleClick)
    return () => {
      document.removeEventListener('click', handleClick)
    }
  }, [])

  // 获取右键菜单项
  const getContextMenuItems = (t: (key: string) => string, selectedText: string) => [
    {
      key: 'copy',
      label: t('common.copy'),
      onClick: () => {
        if (selectedText) {
          navigator.clipboard
            .writeText(selectedText)
            .then(() => {
              window.message.success({ content: t('message.copied'), key: 'copy-message' })
            })
            .catch(() => {
              window.message.error({ content: t('message.copy.failed'), key: 'copy-message-failed' })
            })
        }
      }
    },
    {
      key: 'quote',
      label: t('chat.message.quote'),
      onClick: () => {
        if (selectedText) {
          window.api?.quoteToMainWindow(selectedText)
        }
      }
    }
  ]

  return (
    <ContextContainer onContextMenu={handleContextMenu} className="context-menu-container">
      {contextMenuPosition && (
        <Dropdown
          overlayStyle={{ position: 'fixed', left: contextMenuPosition.x, top: contextMenuPosition.y, zIndex: 1000 }}
          menu={{ items: getContextMenuItems(t, selectedText) }}
          open={true}
          trigger={['contextMenu']}>
          <div />
        </Dropdown>
      )}
      {children}
    </ContextContainer>
  )
}

const ContextContainer = styled.div``

export default ContextMenu
