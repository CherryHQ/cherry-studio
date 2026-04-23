import { Center, MenuItem, MenuList } from '@cherrystudio/ui'
import { Alert, Modal, Spin } from 'antd'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { LeftMenu, Settings, settingsModalStyles } from './shared'

export type SettingsPopupTab =
  | 'essential'
  | 'prompt'
  | 'permission-mode'
  | 'tools-mcp'
  | 'mcp'
  | 'advanced'
  | 'plugins'
  | 'installed'

export type SettingsMenuItem = {
  key: SettingsPopupTab
  label: string
  icon?: ReactNode
}

interface BaseSettingsPopupProps {
  isLoading: boolean
  error: Error | null
  initialTab?: SettingsPopupTab
  onClose: () => void
  titleContent: ReactNode
  menuItems: SettingsMenuItem[]
  renderTabContent: (tab: SettingsPopupTab) => ReactNode
}

export const BaseSettingsPopup: React.FC<BaseSettingsPopupProps> = ({
  isLoading,
  error,
  initialTab = 'essential',
  onClose,
  titleContent,
  menuItems,
  renderTabContent
}) => {
  const [open, setOpen] = useState(true)
  const { t } = useTranslation()
  const [menu, setMenu] = useState<SettingsPopupTab>(initialTab)

  const handleClose = () => {
    setOpen(false)
  }

  const afterClose = () => {
    onClose()
  }

  const renderContent = () => {
    if (isLoading) {
      return (
        <Center className="flex-1">
          <Spin />
        </Center>
      )
    }

    if (error) {
      return (
        <Center className="flex-1">
          <Alert type="error" message={t('agent.get.error.failed')} />
        </Center>
      )
    }

    return (
      <div className="flex w-full flex-1">
        <LeftMenu>
          <MenuList className="w-[220px] p-1.25 pt-1.75">
            {menuItems.map((item) => (
              <MenuItem
                key={item.key}
                label={item.label}
                icon={item.icon}
                active={menu === item.key}
                className="mb-[7px] font-medium last:mb-0"
                onClick={() => setMenu(item.key)}
              />
            ))}
          </MenuList>
        </LeftMenu>
        <Settings>{renderTabContent(menu)}</Settings>
      </div>
    )
  }

  return (
    <Modal
      open={open}
      onOk={handleClose}
      onCancel={handleClose}
      afterClose={afterClose}
      maskClosable={menu !== 'prompt'}
      footer={null}
      title={titleContent}
      transitionName="animation-move-down"
      styles={settingsModalStyles}
      rootClassName="[&_.ant-modal-title]:text-sm [&_.ant-modal-close]:top-1 [&_.ant-modal-close]:right-1"
      width="min(900px, 70vw)"
      centered>
      {renderContent()}
    </Modal>
  )
}
