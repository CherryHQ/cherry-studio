import { Center } from '@renderer/components/Layout'
import type { MenuProps } from 'antd'
import { Alert, Spin } from 'antd'
import type { ReactNode } from 'react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import { LeftMenu, Settings, settingsModalStyles, StyledMenu, StyledModal } from './shared'

export type SettingsPopupTab =
  | 'essential'
  | 'prompt'
  | 'permission-mode'
  | 'tools-mcp'
  | 'advanced'
  | 'plugins'
  | 'installed'

export type SettingsMenuItem = NonNullable<MenuProps['items']>[number] & {
  key: SettingsPopupTab
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
        <Center flex={1}>
          <Spin />
        </Center>
      )
    }

    if (error) {
      return (
        <Center flex={1}>
          <Alert type="error" message={t('agent.get.error.failed')} />
        </Center>
      )
    }

    return (
      <div className="flex w-full flex-1">
        <LeftMenu>
          <StyledMenu
            defaultSelectedKeys={[initialTab]}
            mode="vertical"
            selectedKeys={[menu]}
            items={menuItems}
            onSelect={({ key }) => setMenu(key as SettingsPopupTab)}
          />
        </LeftMenu>
        <Settings>{renderTabContent(menu)}</Settings>
      </div>
    )
  }

  return (
    <StyledModal
      open={open}
      onOk={handleClose}
      onCancel={handleClose}
      afterClose={afterClose}
      maskClosable={menu !== 'prompt'}
      footer={null}
      title={titleContent}
      transitionName="animation-move-down"
      styles={settingsModalStyles}
      width="min(900px, 70vw)"
      centered>
      {renderContent()}
    </StyledModal>
  )
}
