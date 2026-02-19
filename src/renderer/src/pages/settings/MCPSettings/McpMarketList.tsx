import {
  Composio,
  Github,
  Glama,
  Higress,
  Mcp,
  Mcpso,
  Modelscope,
  Pulse,
  Smithery,
  Zhipu
} from '@cherrystudio/ui/icons'
import { ExternalLink } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingTitle } from '..'

const mcpMarkets = [
  {
    name: 'BigModel MCP Market',
    url: 'https://bigmodel.cn/marketplace/index/mcp',
    logo: Zhipu,
    descriptionKey: 'settings.mcp.more.zhipu'
  },
  {
    name: 'modelscope.cn',
    url: 'https://www.modelscope.cn/mcp',
    logo: Modelscope,
    descriptionKey: 'settings.mcp.more.modelscope'
  },
  {
    name: 'mcp.higress.ai',
    url: 'https://mcp.higress.ai/',
    logo: Higress,
    descriptionKey: 'settings.mcp.more.higress'
  },
  {
    name: 'mcp.so',
    url: 'https://mcp.so/',
    logo: Mcpso,
    descriptionKey: 'settings.mcp.more.mcpso'
  },
  {
    name: 'smithery.ai',
    url: 'https://smithery.ai/',
    logo: Smithery,
    descriptionKey: 'settings.mcp.more.smithery'
  },
  {
    name: 'glama.ai',
    url: 'https://glama.ai/mcp/servers',
    logo: Glama,
    descriptionKey: 'settings.mcp.more.glama'
  },
  {
    name: 'pulsemcp.com',
    url: 'https://www.pulsemcp.com',
    logo: Pulse,
    descriptionKey: 'settings.mcp.more.pulsemcp'
  },
  {
    name: 'mcp.composio.dev',
    url: 'https://mcp.composio.dev/',
    logo: Composio,
    descriptionKey: 'settings.mcp.more.composio'
  },
  {
    name: 'Model Context Protocol Servers',
    url: 'https://github.com/modelcontextprotocol/servers',
    logo: Mcp,
    descriptionKey: 'settings.mcp.more.official'
  },
  {
    name: 'Awesome MCP Servers',
    url: 'https://github.com/punkpeye/awesome-mcp-servers',
    logo: Github,
    descriptionKey: 'settings.mcp.more.awesome'
  }
]

const McpMarketList: FC = () => {
  const { t } = useTranslation()

  return (
    <>
      <SettingTitle style={{ marginBottom: 10 }}>{t('settings.mcp.findMore')}</SettingTitle>
      <MarketGrid>
        {mcpMarkets.map((resource) => (
          <MarketCard key={resource.name} onClick={() => window.open(resource.url, '_blank', 'noopener,noreferrer')}>
            <MarketHeader>
              {typeof resource.logo !== 'string' ? (
                <resource.logo.Avatar size={24} shape="rounded" className="mr-2" />
              ) : (
                <MarketLogo src={resource.logo} alt={`${resource.name} logo`} />
              )}
              <MarketName>{resource.name}</MarketName>
              <ExternalLinkIcon>
                <ExternalLink size={14} />
              </ExternalLinkIcon>
            </MarketHeader>
            <MarketDescription>{t(resource.descriptionKey)}</MarketDescription>
          </MarketCard>
        ))}
      </MarketGrid>
    </>
  )
}

const MarketGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
`

const MarketCard = styled.div`
  display: flex;
  flex-direction: column;
  border: 0.5px solid var(--color-border);
  border-radius: var(--list-item-border-radius);
  padding: 12px 16px;
  transition: all 0.2s ease;
  background-color: var(--color-background);
  cursor: pointer;
  height: 80px;

  &:hover {
    border-color: var(--color-primary);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  }
`

const MarketHeader = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 8px;
`

const MarketLogo = styled.img`
  width: 24px;
  height: 24px;
  border-radius: 4px;
  object-fit: cover;
  margin-right: 8px;
`

const MarketName = styled.span`
  font-size: 14px;
  font-weight: 500;
  flex: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`

const ExternalLinkIcon = styled.div`
  color: var(--color-text-3);
  display: flex;
  align-items: center;
`

const MarketDescription = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.4;
`

export default McpMarketList
