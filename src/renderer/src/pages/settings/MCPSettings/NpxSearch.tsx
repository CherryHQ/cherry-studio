import { CheckOutlined, PlusOutlined } from '@ant-design/icons'
import { nanoid } from '@reduxjs/toolkit'
import npmLogo from '@renderer/assets/images/mcp/npm.svg'
import { Center, HStack } from '@renderer/components/Layout'
import { useMCPServers } from '@renderer/hooks/useMCPServers'
import { builtinMCPServers } from '@renderer/store/mcp'
import { MCPServer } from '@renderer/types'
import { getMcpConfigSampleFromReadme } from '@renderer/utils'
import { Button, Card, Flex, Input, Space, Spin, Tag, Typography } from 'antd'
import { npxFinder } from 'npx-scope-finder'
import { type FC, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

interface SearchResult {
  name: string
  description: string
  version: string
  usage: string
  npmLink: string
  fullName: string
  type: MCPServer['type']
  configSample?: MCPServer['configSample']
}

const npmScopes = ['@cherry', '@modelcontextprotocol', '@gongrzhe', '@mcpmarket']

let _searchResults: SearchResult[] = []

const NpxSearch: FC<{
  setSelectedMcpServer: (server: MCPServer) => void
}> = ({ setSelectedMcpServer }) => {
  const { t } = useTranslation()
  const { Text, Link } = Typography

  // Add new state variables for npm scope search
  const [npmScope, setNpmScope] = useState('@cherry')
  const [searchLoading, setSearchLoading] = useState(false)
  const [searchResults, setSearchResults] = useState<SearchResult[]>(_searchResults)
  const { addMCPServer, mcpServers } = useMCPServers()

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
        let configSample
        if (pkg.original?.readme) {
          configSample = getMcpConfigSampleFromReadme(pkg.original.readme)
        }

        return {
          key: pkg.name,
          name: pkg.name?.split('/')[1] || '',
          description: pkg.description || 'No description available',
          version: pkg.version || 'Latest',
          usage: `npx ${pkg.name}`,
          npmLink: pkg.links?.npm || `https://www.npmjs.com/package/${pkg.name}`,
          fullName: pkg.name || '',
          type: 'stdio',
          configSample
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
    <Container>
      <Center>
        <Space direction="vertical" style={{ marginBottom: 25, width: 500 }}>
          <Center style={{ marginBottom: 15 }}>
            <img src={npmLogo} alt="npm" width={100} />
          </Center>
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder={t('settings.mcp.npx_list.scope_placeholder')}
              value={npmScope}
              onChange={(e) => setNpmScope(e.target.value)}
              onPressEnter={() => handleNpmSearch(npmScope)}
              size="large"
              styles={{ input: { borderRadius: 100 } }}
            />
          </Space.Compact>
          <HStack alignItems="center" justifyContent="center">
            {npmScopes.map((scope) => (
              <Tag
                key={scope}
                bordered={false}
                onClick={() => {
                  setNpmScope(scope)
                  handleNpmSearch(scope)
                }}
                style={{
                  cursor: searchLoading ? 'not-allowed' : 'pointer',
                  borderRadius: 100,
                  backgroundColor: 'var(--color-background-mute)'
                }}>
                {scope}
              </Tag>
            ))}
          </HStack>
        </Space>
      </Center>
      {searchLoading && (
        <Center>
          <Spin />
        </Center>
      )}
      {!searchLoading && (
        <ResultList>
          {searchResults?.map((record) => {
            const isInstalled = mcpServers.some((server) => server.name === record.name)
            return (
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
                      icon={
                        isInstalled ? <CheckOutlined style={{ color: 'var(--color-primary)' }} /> : <PlusOutlined />
                      }
                      size="small"
                      onClick={() => {
                        if (isInstalled) {
                          return
                        }

                        const buildInServer = builtinMCPServers.find((server) => server.name === record.name)

                        if (buildInServer) {
                          addMCPServer(buildInServer)
                          window.message.success({ content: t('settings.mcp.addSuccess'), key: 'mcp-add-server' })
                          setSelectedMcpServer(buildInServer)
                          return
                        }

                        const newServer = {
                          id: nanoid(),
                          name: record.name,
                          description: `${record.description}\n\n${t('settings.mcp.npx_list.usage')}: ${record.usage}\n${t('settings.mcp.npx_list.npm')}: ${record.npmLink}`,
                          command: 'npx',
                          args: record.configSample?.args ?? ['-y', record.fullName],
                          env: record.configSample?.env,
                          isActive: false,
                          type: record.type,
                          configSample: record.configSample
                        }

                        addMCPServer(newServer)
                        window.message.success({ content: t('settings.mcp.addSuccess'), key: 'mcp-add-server' })
                        setSelectedMcpServer(newServer)
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
            )
          })}
        </ResultList>
      )}
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 8px;
`

const ResultList = styled.div`
  flex: 1;
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
  width: 100%;
  padding-right: 4px;
  overflow-y: auto;
  max-width: 1200px;
  margin: 0 auto;
`

export default NpxSearch
