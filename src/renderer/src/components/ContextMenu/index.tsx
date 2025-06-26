import { Dropdown } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface ContextMenuProps {
  children: React.ReactNode
}

const ContextMenu: React.FC<ContextMenuProps> = ({ children }) => {
  const { t } = useTranslation()
  const [selectedText, setSelectedText] = useState<string | undefined>(undefined)

  const contextMenuItems = useMemo(() => {
    if (!selectedText) return []

    return [
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
  }, [selectedText, t])

  const onOpenChange = (open: boolean) => {
    if (open) {
      const selectedText = window.getSelection()?.toString()
      setSelectedText(selectedText)
    }
  }

  return (
    <Dropdown onOpenChange={onOpenChange} menu={{ items: contextMenuItems }} trigger={['contextMenu']}>
      {children}
    </Dropdown>
  )
}

export default ContextMenu
