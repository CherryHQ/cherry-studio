import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { nanoid } from '@reduxjs/toolkit'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { builtinMCPServers } from '@renderer/store/mcp'
import { Button, Card, Flex, Input, Space, Spin, Tag, Typography } from 'antd'
import { npxFinder } from 'npx-scope-finder'
import { type FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled, { css } from 'styled-components'

import { SettingDivider, SettingGroup, SettingTitle } from '..'

interface SearchResult {
  name: string
  description: string
  version: string
  usage: string
  npmLink: string
  fullName: string
  type: 'stdio' | 'sse' | 'inMemory'
}

const npmScopes = ['@cherry', '@modelcontextprotocol', '@gongrzhe', '@mcpmarket']

let _searchResults: SearchResult[] = []

const NpxSearch: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { Text, Link } = Typography

  // Add new state variables for npm scope search
  const [npmScope, setNpmScope] = useState('@cherry')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>(_searchResults)
  const { addMCPServer } = useMCPServers()

  _searchResults = searchResults

  // Add new function to handle npm scope search
  const handleNpmSearch = async (scopeOverride?: string) => {
    const searchScope = scopeOverride || npmScope

    if (!searchScope.trim()) {
      window.message.warning({ content: t('settings.mcp.npx_list.scope_required'), key: 'mcp-npx-scope-required' })
      return
    }

    if (searchLoading) {
      return
    }

    if (searchScope === '@cherry') {
      setSearchResults(
        builtinMCPServers.map((server) => ({
          key: server.id,
          name: server.name,
          description: server.description || '',
          version: '1.0.0',
          usage: '参考下方链接中的使用说明',
          npmLink: 'https://docs.cherry-ai.com/advanced-basic/mcp/in-memory',
          fullName: server.name,
          type: server.type || 'inMemory'
        }))
      )
      return
    }

    setSearchLoading(true)

    try {
      // Call npxFinder to search for packages
      const packages = await npxFinder(searchScope)

      // Map the packages to our desired format
      const formattedResults: SearchResult[] = packages.map((pkg) => {
        return {
          key: pkg.name,
          name: pkg.name?.split('/')[1] || '',
          description: pkg.description || 'No description available',
          version: pkg.version || 'Latest',
          usage: `npx ${pkg.name}`,
          npmLink: pkg.links?.npm || `https://www.npmjs.com/package/${pkg.name}`,
          fullName: pkg.name || '',
          type: 'stdio'
        }
      })

      setSearchResults(formattedResults)

      if (formattedResults.length === 0) {
        window.message.info({ content: t('settings.mcp.npx_list.no_packages'), key: 'mcp-npx-no-packages' })
      }
    } catch (error: unknown) {
      setSearchResults([])
      _searchResults = []
      if (error instanceof Error) {
        window.message.error({
          content: `${t('settings.mcp.npx_list.search_error')}: ${error.message}`,
          key: 'mcp-npx-search-error'
        })
      } else {
        window.message.error({ content: t('settings.mcp.npx_list.search_error'), key: 'mcp-npx-search-error' })
      }
    } finally {
      setSearchLoading(false)
    }
  }

  useEffect(() => {
    handleNpmSearch()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <SettingGroup theme={theme} css={SettingGroupCss}>
      <div>
        <SettingTitle>
          {t('settings.mcp.npx_list.title')} <Text type="secondary">{t('settings.mcp.npx_list.desc')}</Text>
        </SettingTitle>
        <SettingDivider />

        <Space direction="vertical" style={{ width: '100%' }}>
          <Space.Compact style={{ width: '100%', marginBottom: 10 }}>
            <Input
              placeholder={t('settings.mcp.npx_list.scope_placeholder')}
              value={npmScope}
              onChange={(e) => setNpmScope(e.target.value)}
              onPressEnter={() => handleNpmSearch(npmScope)}
            />
            <Button icon={<SearchOutlined />} onClick={() => handleNpmSearch(npmScope)} disabled={searchLoading}>
              {t('settings.mcp.npx_list.search')}
            </Button>
          </Space.Compact>
          <HStack alignItems="center" mt="-5px" mb="5px">
            {npmScopes.map((scope) => (
              <Tag
                key={scope}
                onClick={() => {
                  setNpmScope(scope)
                  handleNpmSearch(scope)
                }}
                style={{ cursor: searchLoading ? 'not-allowed' : 'pointer' }}>
                {scope}
              </Tag>
            ))}
          </HStack>
        </Space>
      </div>

      <ResultList>
        {searchLoading ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <Spin />
          </div>
        ) : (
          searchResults?.map((record) => (
            <Card
              size="small"
              key={record.name}
              title={
                <Typography.Title level={5} style={{ margin: 0 }} className="selectable">
                  {record.name}
                </Typography.Title>
              }
              extra={
                <Flex>
                  <Tag bordered={false} color="processing">
                    v{record.version}
                  </Tag>
                  <Button
                    type="text"
                    icon={<PlusOutlined />}
                    size="small"
                    onClick={() => {
                      const buildInServer = builtinMCPServers.find((server) => server.name === record.name)

                      if (buildInServer) {
                        addMCPServer(buildInServer)
                        return
                      }

                      addMCPServer({
                        id: nanoid(),
                        name: record.name,
                        description: `${record.description}\n\n${t('settings.mcp.npx_list.usage')}: ${record.usage}\n${t('settings.mcp.npx_list.npm')}: ${record.npmLink}`,
                        command: 'npx',
                        args: ['-y', record.fullName],
                        isActive: false,
                        type: record.type
                      })
                    }}
                  />
                </Flex>
              }>
              <Space direction="vertical" size="small">
                <Text className="selectable">{record.description}</Text>
                <Text type="secondary" className="selectable">
                  {t('settings.mcp.npx_list.usage')}: {record.usage}
                </Text>
                <Link href={record.npmLink} target="_blank" rel="noopener noreferrer">
                  {record.npmLink}
                </Link>
              </Space>
            </Card>
          ))
        )}
      </ResultList>
    </SettingGroup>
  )
}

const SettingGroupCss = css`
  height: 100%;
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 0;
`

const ResultList = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: calc(100% + 10px);
  padding-right: 4px;
  overflow-y: scroll;
`

export default NpxSearch
