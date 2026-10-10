import { ExternalLink } from 'lucide-react'
import type React from 'react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import { SettingTitle } from '@renderer/components/SettingsPrimitives'
import { openExternalWebsite } from '@renderer/services/website'
import { MCP_MARKETS } from '@renderer/utils/mcpDiscovery'
import { cn } from '@renderer/utils/style'

const McpMarketList: FC = () => {
  const { t } = useTranslation()

  return (
    <>
      <SettingTitle style={{ marginBottom: 10 }}>{t('settings.mcp.findMore')}</SettingTitle>
      <MarketGrid>
        {MCP_MARKETS.map((resource) => (
          <MarketCard key={resource.name} onClick={() => void openExternalWebsite(resource.url)}>
            <MarketIconWrap>
              {typeof resource.logo !== 'string' ? (
                <resource.logo.Avatar size={22} shape="rounded" />
              ) : (
                <MarketLogo src={resource.logo} alt={`${resource.name} logo`} />
              )}
            </MarketIconWrap>
            <MarketContent>
              <MarketHeader>
                <MarketName>{resource.name}</MarketName>
                <ExternalLinkIcon>
                  <ExternalLink size={13} />
                </ExternalLinkIcon>
              </MarketHeader>
              <MarketDescription>{t(resource.descriptionKey)}</MarketDescription>
            </MarketContent>
          </MarketCard>
        ))}
      </MarketGrid>
    </>
  )
}

const MarketGrid = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('mb-5 flex flex-col gap-2', className)} {...props} />
)

const MarketCard = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn(
      'flex min-h-15 cursor-pointer items-center gap-3 rounded-lg border border-border-subtle bg-transparent px-3 py-2.5 transition-colors hover:bg-accent',
      className
    )}
    {...props}
  />
)

const MarketIconWrap = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted', className)} {...props} />
)

const MarketContent = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('min-w-0 flex-1', className)} {...props} />
)

const MarketHeader = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex items-center gap-2', className)} {...props} />
)

const MarketLogo = ({ className, ...props }: React.ComponentPropsWithoutRef<'img'>) => (
  <img className={cn('size-5.5 rounded object-cover', className)} {...props} />
)

const MarketName = ({ className, ...props }: React.ComponentPropsWithoutRef<'span'>) => (
  <span className={cn('flex-1 truncate text-sm', className)} {...props} />
)

const ExternalLinkIcon = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div className={cn('flex shrink-0 items-center text-foreground-tertiary', className)} {...props} />
)

const MarketDescription = ({ className, ...props }: React.ComponentPropsWithoutRef<'div'>) => (
  <div
    className={cn('mt-0.5 line-clamp-1 overflow-hidden text-[13px] text-muted-foreground leading-[1.35]', className)}
    {...props}
  />
)

export default McpMarketList
