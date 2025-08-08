import { GlobalOutlined } from '@ant-design/icons'
import { HStack } from '@renderer/components/Layout'
import ListItem from '@renderer/components/ListItem'
import { FileCode, Zap } from 'lucide-react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, Route, Routes, useLocation } from 'react-router-dom'
import styled from 'styled-components'

import PreprocessSettings from './PreprocessSettings'
import QuickPhraseSettings from './QuickPhraseSettings'
import WebSearchSettings from './WebSearchSettings'

const ToolSettings: FC = () => {
  const { t } = useTranslation()
  const { pathname } = useLocation()
  const menuItems = [
    { key: 'web-search', title: 'settings.tool.websearch.title', icon: <GlobalOutlined style={{ fontSize: 16 }} /> },
    { key: 'preprocess', title: 'settings.tool.preprocess.title', icon: <FileCode size={16} /> },
    { key: 'quick-phrase', title: 'settings.quickPhrase.title', icon: <Zap size={16} /> }
  ]

  const isActive = (key: string): boolean => {
    const basePath = '/settings/tool'
    if (key === 'web-search') {
      return pathname === basePath || pathname === `${basePath}/` || pathname === `${basePath}/${key}`
    }
    return pathname === `${basePath}/${key}`
  }

  return (
    <Container>
      <MenuList>
        {menuItems.map((item) => (
          <Link key={item.key} to={`/settings/tool/${item.key}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <ListItem
              title={t(item.title)}
              active={isActive(item.key)}
              titleStyle={{ fontWeight: 500 }}
              icon={item.icon}
            />
          </Link>
        ))}
      </MenuList>
      <ContentArea>
        <Routes>
          <Route path="/" element={<WebSearchSettings />} />
          <Route path="/web-search" element={<WebSearchSettings />} />
          <Route path="/preprocess" element={<PreprocessSettings />} />
          <Route path="/quick-phrase" element={<QuickPhraseSettings />} />
        </Routes>
      </ContentArea>
    </Container>
  )
}

const Container = styled(HStack)`
  flex: 1;
`

const MenuList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 5px;
  width: var(--settings-width);
  padding: 12px;
  border-right: 0.5px solid var(--color-border);
  height: 100%;
  .iconfont {
    line-height: 16px;
  }
`

const ContentArea = styled.div`
  display: flex;
  flex: 1;
  height: 100%;
`
export default ToolSettings
