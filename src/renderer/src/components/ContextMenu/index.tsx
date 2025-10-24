import { Dropdown } from 'antd'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { getSelectedText } from '@renderer/utils/selection'

interface ContextMenuProps {
  children: React.ReactNode
}

// FIXME: Why does this component name look like a generic component but is not customizable at all?
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
                window.toast.success(t('message.copied'))
              })
              .catch(() => {
                window.toast.error(t('message.copy.failed'))
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
      const selectedText = getSelectedText()
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
