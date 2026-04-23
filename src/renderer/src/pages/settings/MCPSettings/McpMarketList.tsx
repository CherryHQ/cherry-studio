import { Composio, Glama, Higress, Mcp, Mcpso, Modelscope, Pulse, Smithery, Zhipu } from '@cherrystudio/ui/icons'
import { cn } from '@renderer/utils/style'
import { ExternalLink } from 'lucide-react'
import type React from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingTitle } from '..'

const mcpMarkets = [
  {
    name: 'MCP World',
    url: 'https://www.mcpworld.com',
    logo: 'https://mcpworld.bdstatic.com/store/v2/865ad5d/mcp-server-store/ec04344/favicon.ico',
    descriptionKey: 'settings.mcp.more.mcpworld'
  },
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
    url: 'https://github.com/wong2/awesome-mcp-servers',
    logo: 'https://github.githubassets.com/assets/github-logo-55c5b9a1fe52.png',
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

const MarketGrid = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-5 grid grid-cols-[repeat(auto-fill,minmax(280px,1fr))] gap-3', className)} {...props} />
)

const MarketCard = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'flex h-20 cursor-pointer flex-col rounded-[var(--cs-radius-2xs)] border-[0.5px] border-border bg-background px-4 py-3 transition-all hover:border-primary hover:shadow-[0_2px_8px_rgba(0,0,0,0.1)]',
      className
    )}
    {...props}
  />
)

const MarketHeader = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-2 flex items-center', className)} {...props} />
)

const MarketLogo = ({ className, ...props }: React.ComponentPropsWithoutRef<'img'>) => (
  <img className={cn('mr-2 h-6 w-6 rounded object-cover', className)} {...props} />
)

const MarketName = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('flex-1 truncate font-medium text-sm', className)} {...props} />
)

const ExternalLinkIcon = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex items-center text-foreground-muted', className)} {...props} />
)

const MarketDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn('line-clamp-2 overflow-hidden text-foreground-secondary text-xs leading-[1.4]', className)}
    {...props}
  />
)

export default McpMarketList
