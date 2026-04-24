import { Button, PageSidePanel } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'
import { Check, Cpu, Play, Sparkles, Terminal as TerminalIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { CliIconBadge } from './CliIconBadge'
import type { CodeToolMeta } from './types'

interface DrawerProps {
  open: boolean
  tool: CodeToolMeta | null
  summary?: {
    model?: string
    terminal?: string
  }
  canLaunch: boolean
  launching: boolean
  launchSuccess?: boolean
  infoTag?: string
  onClose: () => void
  onLaunch: () => void
  children?: ReactNode
}

export function CodeToolDrawer({
  open,
  tool,
  summary,
  canLaunch,
  launching,
  launchSuccess = false,
  infoTag,
  onClose,
  onLaunch,
  children
}: DrawerProps) {
  const { t } = useTranslation()

  if (!tool) {
    return null
  }

  const header = (
    <div className="flex items-center gap-2">
      <CliIconBadge tool={tool} size={28} />
      <span className="text-[11px] text-foreground">{tool.label}</span>
    </div>
  )

  const footer = (
    <>
      {summary && (
        <div className="flex items-center gap-2 text-[9px] text-muted-foreground/30">
          <div className="flex items-center gap-1">
            <Cpu size={9} />
            <span>{tool.label}</span>
          </div>
          {summary.model && (
            <>
              <span className="text-border/30">·</span>
              <div className="flex min-w-0 items-center gap-1 truncate">
                <Sparkles size={8} />
                <span className="truncate">{summary.model}</span>
              </div>
            </>
          )}
          {summary.terminal && (
            <>
              <span className="text-border/30">·</span>
              <div className="flex items-center gap-1">
                <TerminalIcon size={9} />
                <span>{summary.terminal}</span>
              </div>
            </>
          )}
        </div>
      )}

      <Button
        variant={launchSuccess ? 'secondary' : 'default'}
        onClick={onLaunch}
        disabled={!canLaunch || launching}
        loading={launching}
        loadingIcon={
          <span className="h-3 w-3 animate-spin rounded-full border-2 border-background/30 border-t-background" />
        }
        className={cn(
          'w-full gap-2 rounded-3xs py-2 text-[11px] shadow-none active:scale-[0.99] disabled:opacity-60',
          !launchSuccess && 'bg-foreground text-background hover:bg-foreground/90'
        )}>
        {launchSuccess ? (
          <>
            <Check size={12} />
            <span>{t('code.launch.launched')}</span>
          </>
        ) : launching ? (
          <span>{t('code.launching')}</span>
        ) : (
          <>
            <Play size={11} className="text-background" />
            <span>{t('code.launch.label')}</span>
          </>
        )}
      </Button>
    </>
  )

  return (
    <PageSidePanel open={open} onClose={onClose} header={header} footer={footer} closeLabel={t('common.close')}>
      <div className="flex items-center gap-3 rounded-2xs border border-border/10 bg-accent/5 p-3">
        <CliIconBadge tool={tool} size={44} />
        <div className="min-w-0 flex-1">
          <div className="text-[11px] text-foreground">{tool.label}</div>
          {infoTag && (
            <div className="mt-1 flex items-center gap-2">
              <span className="rounded-4xs bg-accent/40 px-1.5 py-0.5 text-[9px] text-muted-foreground/50">
                {infoTag}
              </span>
            </div>
          )}
        </div>
      </div>

      {children}
    </PageSidePanel>
  )
}
