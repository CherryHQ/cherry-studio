import { ChromeOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { Navbar, NavbarCenter, NavbarRight } from '@renderer/components/app/Navbar'
import { Center, HStack } from '@renderer/components/Layout'
import Scrollbar from '@renderer/components/Scrollbar'
import { useExtensions } from '@renderer/hooks/useExtensions'
import { Extension } from '@shared/config/types'
import { Button, Empty, Input, List, Skeleton, Tooltip, Typography } from 'antd'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import ExtensionCard from './components/ExtensionCard'

const { Text } = Typography

const ExtensionsPage: FC = () => {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const { extensions, loading, error, uninstallExtension, updateExtensions, openChromeStore, toggleEnabled } =
    useExtensions()

  const filteredExtensions = search
    ? extensions.filter(
        (extension) =>
          extension.name.toLowerCase().includes(search.toLowerCase()) ||
          extension.description?.toLowerCase().includes(search.toLowerCase())
      )
    : extensions

  return (
    <Container>
      <Navbar>
        <NavbarCenter style={{ borderInlineEnd: 'none' }}>{t('extensions.title')}</NavbarCenter>
        <NavbarRight>
          <HStack gap={8}>
            <Tooltip title={t('extensions.update', 'Update extensions')}>
              <Button
                type="text"
                icon={<ReloadOutlined />}
                onClick={updateExtensions}
                loading={loading}
                className="nodrag"
              />
            </Tooltip>
            <Tooltip title={t('extensions.browse_store', 'Browse Chrome Web Store')}>
              <Button type="text" icon={<ChromeOutlined />} onClick={openChromeStore} className="nodrag" />
            </Tooltip>
            <SearchInput
              placeholder={t('extensions.search.placeholder', 'Search extensions')}
              prefix={<SearchOutlined />}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              allowClear
              className="nodrag"
            />
          </HStack>
        </NavbarRight>
      </Navbar>

      <ContentContainer id="content-container">
        <MainContent>
          <Scrollbar>
            {loading && extensions.length === 0 ? (
              <LoadingContainer>
                <Skeleton active paragraph={{ rows: 10 }} />
              </LoadingContainer>
            ) : error ? (
              <ErrorContainer>
                <Text type="danger">{error}</Text>
                <Button onClick={updateExtensions} icon={<ReloadOutlined />}>
                  {t('extensions.retry', 'Retry')}
                </Button>
              </ErrorContainer>
            ) : filteredExtensions.length === 0 ? (
              <EmptyContainer>
                <Empty
                  description={
                    search
                      ? t('extensions.no_search_results', 'No extensions found matching your search')
                      : t('extensions.no_extensions', 'No extensions installed')
                  }
                />
                <Button type="primary" icon={<ChromeOutlined />} onClick={openChromeStore}>
                  {t('extensions.browse_store', 'Browse Chrome Web Store')}
                </Button>
              </EmptyContainer>
            ) : (
              <ExtensionsList
                dataSource={filteredExtensions}
                renderItem={(extension: Extension) => (
                  <ExtensionCard
                    extension={extension}
                    onToggle={() => toggleEnabled(extension.id)}
                    onUninstall={() => uninstallExtension(extension.id)}
                  />
                )}
              />
            )}
          </Scrollbar>
        </MainContent>
      </ContentContainer>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  height: 100%;
`

const ContentContainer = styled.div`
  display: flex;
  justify-content: center;
  flex-direction: row;
  height: 100%;
`

const MainContent = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  padding: 12px;
  width: 100%;
  height: 100%;
`

const SearchInput = styled(Input)`
  width: 300px;
`

const ExtensionsList = styled(List<Extension>)`
  display: flex;
  flex-direction: column;
  flex: 1;
  gap: 12px;
  width: 100%;
  height: 100%;
  .ant-list-item {
    padding: 12px;
    margin-bottom: 12px;
    border-radius: 8px;
    background-color: var(--color-bg-2);
    border: 1px solid var(--color-border);
  }
`

const LoadingContainer = styled.div`
  padding: 24px;
`

const ErrorContainer = styled(Center)`
  flex-direction: column;
  gap: 16px;
  padding: 24px;
`

const EmptyContainer = styled(Center)`
  flex-direction: column;
  gap: 16px;
  padding: 24px;
`

export default ExtensionsPage
