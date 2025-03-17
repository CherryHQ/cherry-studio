import { SearchOutlined } from '@ant-design/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { MCPServer } from '@renderer/types'
import { Button, Input, Space, Spin, Table, Typography } from 'antd'
import { npxFinder } from 'npx-scope-finder'
import { FC, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingDivider, SettingGroup, SettingTitle } from '..'
import AddMcpServerPopup from './AddMcpServerPopup'

interface SearchResult {
  name: string
  description: string
  version: string
  usage: string
  npmLink: string
  fullName: string
}

const NpxSearch: FC = () => {
  const { theme } = useTheme()
  const { t } = useTranslation()
  const { Paragraph, Text } = Typography

  // Add new state variables for npm scope search
  const [npmScope, setNpmScope] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])

  // Add new function to handle npm scope search
  const handleNpmSearch = async () => {
    if (!npmScope.trim()) {
      window.message.warning(t('settings.mcp.npx_list.scope_required'))
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
          name: pkg.name || '',
          description: pkg.description || 'No description available',
          version: pkg.version || 'Latest',
          usage: `npx ${pkg.name}`,
          npmLink: pkg.links?.npm || `https://www.npmjs.com/package/${pkg.name}`,
          fullName: pkg.name || ''
        }
      })

      setSearchResults(formattedResults)

      if (formattedResults.length === 0) {
        window.message.info(t('settings.mcp.npx_list.no_packages'))
      }
    } catch (error: any) {
      window.message.error(`${t('settings.mcp.npx_list.search_error')}: ${error.message}`)
    } finally {
      setSearchLoading(false)
    }
  }

  return (
    <SettingGroup theme={theme}>
      <SettingTitle>{t('settings.mcp.npx_list.title')}</SettingTitle>
      <SettingDivider />
      <Paragraph type="secondary" style={{ margin: '0 0 20px 0' }}>
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
          <Button type="primary" icon={<SearchOutlined />} onClick={handleNpmSearch} disabled={searchLoading}>
            {t('settings.mcp.npx_list.search')}
          </Button>
        </Space.Compact>

        {searchLoading ? (
          <div style={{ textAlign: 'center', padding: '20px' }}>
            <Spin />
          </div>
        ) : searchResults.length > 0 ? (
          <Table<SearchResult>
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
                render: (_, record: SearchResult) => (
                  <Space direction="vertical" size="small">
                    <Text>{record.description}</Text>
                    <Text type="secondary" style={{ fontSize: '12px' }}>
                      {t('settings.mcp.npx_list.usage')}: {record.usage}
                    </Text>
                    <a href={record.npmLink} target="_blank" rel="noopener noreferrer" style={{ fontSize: '12px' }}>
                      {record.npmLink}
                    </a>
                  </Space>
                )
              },
              {
                title: t('settings.mcp.npx_list.version'),
                dataIndex: 'version',
                key: 'version',
                width: '100px'
              },
              {
                title: t('settings.mcp.npx_list.actions'),
                key: 'actions',
                width: '100px',
                render: (_, record: SearchResult) => (
                  <Button
                    type="primary"
                    size="small"
                    onClick={() => {
                      // 创建一个临时的 MCP 服务器对象
                      const tempServer: MCPServer = {
                        name: record.name,
                        description: `${record.description}\n\n${t('settings.mcp.npx_list.usage')}: ${record.usage}\n${t('settings.mcp.npx_list.npm')}: ${record.npmLink}`,
                        command: 'npx',
                        args: ['-y', record.fullName],
                        isActive: true
                      }

                      // 使用 showEditModal 函数设置表单值并显示弹窗
                      AddMcpServerPopup.show({ server: tempServer, create: true })
                    }}>
                    {t('settings.mcp.addServer')}
                  </Button>
                )
              }
            ]}
            pagination={false}
            size="small"
            bordered
          />
        ) : null}
      </Space>
    </SettingGroup>
  )
}

export default NpxSearch
