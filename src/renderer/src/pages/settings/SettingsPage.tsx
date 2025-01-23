import {
  CloudOutlined,
  InfoCircleOutlined,
  LayoutOutlined,
  MacCommandOutlined,
  RocketOutlined,
  SaveOutlined,
  SettingOutlined
} from '@ant-design/icons'
import { isLocalAi } from '@renderer/config/env'
import { Breadcrumb, Button, Menu } from 'antd'
import { FC, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import AboutSettings from './AboutSettings'
import DataSettings from './DataSettings/DataSettings'
import DisplaySettings from './DisplaySettings/DisplaySettings'
import GeneralSettings from './GeneralSettings'
import ModelSettings from './ModalSettings/ModelSettings'
import ProvidersList from './ProviderSettings'
import QuickAssistantSettings from './QuickAssistantSettings'
import ShortcutSettings from './ShortcutSettings'

export type SettingsTab =
  | 'provider'
  | 'model'
  | 'general'
  | 'display'
  | 'data'
  | 'quickAssistant'
  | 'shortcut'
  | 'about'

interface Props {
  activeTab?: SettingsTab
}
interface MenuItem {
  label: string
  icon: React.ReactNode
  key: string
  enabled: boolean
}

const SettingsPage: FC<Props> = (props) => {
  const { t } = useTranslation()
  const [activeTab, setActiveTab] = useState<string>(props.activeTab || 'provider')
  const [collapsed, setCollapsed] = useState(false)

  const settingMenus = useMemo<MenuItem[]>(
    () => [
      {
        label: t('settings.provider.title'),
        icon: <CloudOutlined />,
        key: 'provider',
        enabled: !isLocalAi
      },
      {
        label: t('settings.model'),
        icon: <i className="iconfont icon-ai-model" />,
        key: 'model',
        enabled: !isLocalAi
      },
      {
        label: t('settings.general'),
        icon: <SettingOutlined />,
        key: 'general',
        enabled: true
      },
      {
        label: t('settings.display.title'),
        icon: <LayoutOutlined />,
        key: 'display',
        enabled: true
      },
      {
        label: t('settings.shortcuts.title'),
        icon: <MacCommandOutlined />,
        key: 'shortcut',
        enabled: true
      },
      {
        label: t('settings.quickAssistant.title'),
        icon: <RocketOutlined />,
        key: 'quickAssistant',
        enabled: true
      },
      {
        label: t('settings.data.title'),
        icon: <SaveOutlined />,
        key: 'data',
        enabled: true
      },
      {
        label: t('settings.about'),
        icon: <InfoCircleOutlined />,
        key: 'about',
        enabled: true
      }
    ],
    [t]
  )

  const breadcrumbItems = useMemo(() => {
    return [
      {
        title: t('settings.title')
      },
      {
        title: settingMenus.find((item) => item.key === activeTab)?.label
      }
    ]
  }, [t, activeTab, settingMenus])

  const renderContent = () => {
    switch (activeTab) {
      case 'provider':
        return <ProvidersList />
      case 'model':
        return <ModelSettings />
      case 'general':
        return <GeneralSettings />
      case 'display':
        return <DisplaySettings />
      case 'data':
        return <DataSettings />
      case 'quickAssistant':
        return <QuickAssistantSettings />
      case 'shortcut':
        return <ShortcutSettings />
      case 'about':
        return <AboutSettings />
      default:
        return <GeneralSettings />
    }
  }

  return (
    <ContentContainer>
      <MenuContainer $isCollapsed={collapsed}>
        <Title>{t('settings.title')}</Title>
        <Menu
          mode="inline"
          onClick={(e) => setActiveTab(e.key)}
          selectedKeys={[activeTab]}
          items={settingMenus.filter((item) => item.enabled)}
          inlineCollapsed={collapsed}
        />
      </MenuContainer>
      <SettingContent>
        <SettingHeader>
          <CollapseButton shape="circle" type="text" onClick={() => setCollapsed(!collapsed)} $isCollapsed={collapsed}>
            <i className="iconfont icon-hide-sidebar" />
          </CollapseButton>
          <Breadcrumb items={breadcrumbItems} />
        </SettingHeader>
        {renderContent()}
      </SettingContent>
    </ContentContainer>
  )
}

const ContentContainer = styled.div`
  display: flex;
  flex: 1;
  flex-direction: row;
`

const MenuContainer = styled.div<{ $isCollapsed: boolean }>`
  width: ${({ $isCollapsed }) => ($isCollapsed ? '80px' : '160px')};
  background-color: var(--color-background-mute);
  transition: width 0.3s ease-in-out;
  position: relative;
  .ant-menu-light {
    background-color: var(--color-background-mute);
  }
`

const CollapseButton = styled(Button)<{ $isCollapsed: boolean }>`
  color: var(--color-icon);
  .iconfont {
    transform: rotate(${({ $isCollapsed }) => ($isCollapsed ? '180deg' : '0deg')});
  }
`

const Title = styled.div`
  font-size: 16px;
  font-weight: 600;
  padding: 16px 24px;
`

const SettingContent = styled.div`
  height: 100%;
  flex: 1;
`

const SettingHeader = styled.div`
  padding: 4px 8px;
  border-bottom: 0.5px solid var(--color-border);
  display: flex;
  align-items: center;
  gap: 8px;
`

export default SettingsPage
