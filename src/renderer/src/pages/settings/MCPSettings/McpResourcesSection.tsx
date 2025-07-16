import { ExternalLink } from 'lucide-react'
import { FC } from 'react'
import { useTranslation } from 'react-i18next'
import styled from 'styled-components'

import { SettingTitle } from '..'

const mcpResources = [
  {
    name: 'modelscope.cn',
    url: 'https://www.modelscope.cn/mcp',
    logo: 'https://g.alicdn.com/sail-web/maas/2.7.35/favicon/128.ico',
    descriptionKey: 'settings.mcp.more.modelscope'
  },
  {
    name: 'mcp.higress.ai',
    url: 'https://mcp.higress.ai/',
    logo: 'https://framerusercontent.com/images/FD5yBobiBj4Evn0qf11X7iQ9csk.png',
    descriptionKey: 'settings.mcp.more.higress'
  },
  {
    name: 'mcp.so',
    url: 'https://mcp.so/',
    logo: 'https://mcp.so/favicon.ico',
    descriptionKey: 'settings.mcp.more.mcpso'
  },
  {
    name: 'smithery.ai',
    url: 'https://smithery.ai/',
    logo: 'https://smithery.ai/logo.svg',
    descriptionKey: 'settings.mcp.more.smithery'
  },
  {
    name: 'glama.ai',
    url: 'https://glama.ai/mcp/servers',
    logo: 'https://glama.ai/favicon.ico',
    descriptionKey: 'settings.mcp.more.glama'
  },
  {
    name: 'pulsemcp.com',
    url: 'https://www.pulsemcp.com',
    logo: 'https://www.pulsemcp.com/favicon.svg',
    descriptionKey: 'settings.mcp.more.pulsemcp'
  },
  {
    name: 'mcp.composio.dev',
    url: 'https://mcp.composio.dev/',
    logo: 'https://composio.dev/wp-content/uploads/2025/02/Fevicon-composio.png',
    descriptionKey: 'settings.mcp.more.composio'
  },
  {
    name: 'Model Context Protocol Servers',
    url: 'https://github.com/modelcontextprotocol/servers',
    logo: 'https://avatars.githubusercontent.com/u/182288589',
    descriptionKey: 'settings.mcp.more.official'
  },
  {
    name: 'Awesome MCP Servers',
    url: 'https://github.com/punkpeye/awesome-mcp-servers',
    logo: 'https://github.githubassets.com/assets/github-logo-55c5b9a1fe52.png',
    descriptionKey: 'settings.mcp.more.awesome'
  }
]

const McpResourcesSection: FC = () => {
  const { t } = useTranslation()

  return (
    <>
      <SettingTitle style={{ gap: 3 }}>{t('settings.mcp.findMore')}</SettingTitle>
      <ResourcesGrid>
        {mcpResources.map((resource) => (
          <ResourceCard key={resource.name} onClick={() => window.open(resource.url, '_blank', 'noopener,noreferrer')}>
            <ResourceHeader>
              <ResourceLogo src={resource.logo} alt={`${resource.name} logo`} />
              <ResourceName>{resource.name}</ResourceName>
              <ExternalLinkIcon>
                <ExternalLink size={14} />
              </ExternalLinkIcon>
            </ResourceHeader>
            <ResourceDescription>{t(resource.descriptionKey)}</ResourceDescription>
          </ResourceCard>
        ))}
      </ResourcesGrid>
    </>
  )
}

const ResourcesGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 12px;
  margin-bottom: 20px;
`

const ResourceCard = styled.div`
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

const ResourceHeader = styled.div`
  display: flex;
  align-items: center;
  margin-bottom: 8px;
`

const ResourceLogo = styled.img`
  width: 20px;
  height: 20px;
  border-radius: 4px;
  object-fit: cover;
  margin-right: 8px;
`

const ResourceName = styled.span`
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

const ResourceDescription = styled.div`
  font-size: 12px;
  color: var(--color-text-2);
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-height: 1.4;
`

export default McpResourcesSection
