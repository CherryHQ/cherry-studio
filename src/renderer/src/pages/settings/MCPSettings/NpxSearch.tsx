import { PlusOutlined, SearchOutlined } from '@ant-design/icons'
import { nanoid } from '@reduxjs/toolkit'
import { HStack } from '@renderer/components/Layout'
import { useTheme } from '@renderer/context/ThemeProvider'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import type { MCPServer } from '@renderer/types'
import { Button, Input, Space, Spin, Table, Tag, Typography } from 'antd'
import { npxFinder } from 'npx-scope-finder'
import { type FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingTitle } from '..'

interface SearchResult {
  name: string
  description: string
  version: string
  usage: string
  npmLink: string
  fullName: string
}

const npmScopes = ['@mcpmarket', '@modelcontextprotocol', '@gongrzhe']

const NpxSearch: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { Paragraph, Text, Link } = Typography

  // Add new state variables for npm scope search
  const [npmScope, setNpmScope] = useState('@modelcontextprotocol')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const { addMCPServer } = useMCPServers()

  // Add new function to handle npm scope search
  const handleNpmSearch = async () => {
    if (!npmScope.trim()) {
      window.message.warning({ content: t('settings.mcp.npx_list.scope_required'), key: 'mcp-npx-scope-required' })
      return
    }

    if (searchLoading) {
      return
    }

    setSearchLoading(true)

    try {
      // Call npxFinder to search for packages
      const packages = await npxFinder(npmScope)

      // Map the packages to our desired format
      const formattedResults = packages.map((pkg) => {
        return {
          key: pkg.name,
          name: pkg.name?.split('/')[1] || '',
          description: pkg.description || 'No description available',
          version: pkg.version || 'Latest',
          usage: `npx ${pkg.name}`,
          npmLink: pkg.links?.npm || `https://www.npmjs.com/package/${pkg.name}`,
          fullName: pkg.name || ''
        }
      })

      setSearchResults(formattedResults)

      if (formattedResults.length === 0) {
        window.message.info({ content: t('settings.mcp.npx_list.no_packages'), key: 'mcp-npx-no-packages' })
      }
    } catch (error: unknown) {
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

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.mcp.npx_list.title')}</SettingTitle>
      <SettingDivider />
      <Paragraph type="secondary" style={{ margin: '0 0 10px 0' }}>
        {t('settings.mcp.npx_list.desc')}
      </Paragraph>

      <Space direction="vertical" style={{ width: '100%' }}>
        <Space.Compact style={{ width: '100%', marginBottom: 10 }}>
          <Input
            placeholder={t('settings.mcp.npx_list.scope_placeholder')}
            value={npmScope}
            onChange={(e) => setNpmScope(e.target.value)}
            onPressEnter={handleNpmSearch}
          />
          <Button icon={<SearchOutlined />} onClick={handleNpmSearch} disabled={searchLoading}>
            {t('settings.mcp.npx_list.search')}
          </Button>
        </Space.Compact>

        <HStack alignItems="center" mt="-5px" mb="5px">
          {npmScopes.map((scope) => (
            <Tag
              key={scope}
              onClick={() => {
                if (!searchLoading) {
                  setNpmScope(scope)
                  setTimeout(handleNpmSearch, 100)
                }
              }}
              style={{ cursor: searchLoading ? 'not-allowed' : 'pointer' }}>
              {scope}
            </Tag>
          ))}
        </HStack>

        {searchLoading ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <Spin />
          </div>
        ) : searchResults.length > 0 ? (
          <Table
            dataSource={searchResults}
            columns={[
              {
                title: t('settings.mcp.npx_list.package_name'),
                dataIndex: 'name',
                key: 'name',
                width: '200px'
              },
              {
                title: t('settings.mcp.npx_list.description'),
                key: 'description',
                ellipsis: true,
                render: (_, record: SearchResult) => (
                  <Space direction="vertical" size="small" style={{ width: '100%' }}>
                    <Text ellipsis={{ tooltip: true }}>{record.description}</Text>
                    <Text ellipsis={{ tooltip: true }} type="secondary">
                      {t('settings.mcp.npx_list.usage')}: {record.usage}
                    </Text>
                    <Paragraph ellipsis={{ tooltip: true }}>
                      <Link href={record.npmLink} target="_blank" rel="noopener noreferrer">
                        {record.npmLink}
                      </Link>
                    </Paragraph>
                  </Space>
                )
              },
              {
                title: t('settings.mcp.npx_list.version'),
                dataIndex: 'version',
                key: 'version',
                width: '100px',
                align: 'center'
              },
              {
                title: t('settings.mcp.npx_list.actions'),
                key: 'actions',
                width: '80px',
                align: 'center',
                render: (_, record: SearchResult) => (
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    size="small"
                    onClick={() => {
                      // 创建一个临时的 MCP 服务器对象
                      const tempServer: MCPServer = {
                        id: nanoid(),
                        name: record.name,
                        description: `${record.description}\n\n${t('settings.mcp.npx_list.usage')}: ${record.usage}\n${t('settings.mcp.npx_list.npm')}: ${record.npmLink}`,
                        command: 'npx',
                        args: ['-y', record.fullName],
                        isActive: false
                      }
                      addMCPServer(tempServer)
                    }}
                  />
                )
              }
            ]}
            pagination={false}
            bordered
          />
        ) : null}
      </Space>
    </SettingGroup>
  )
}

export default NpxSearch
