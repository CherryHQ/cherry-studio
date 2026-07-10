import { Scrollbar } from '@cherrystudio/ui'
import type { CodeCli } from '@shared/types/codeCli'
import { ArrowUpCircle, Loader2 } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import type { CLI_TOOLS } from '../constants/cliTools'
import type { CodeToolMeta, VersionStatus } from '../types/codeCli'
import { CLIIcon } from './CLIIcon'

type CliToolOption = (typeof CLI_TOOLS)[number]

export interface CodeCliSidebarProps {
  tools: readonly CliToolOption[]
  selectedCliTool: CodeCli
  onSelectTool: (tool: CodeCli) => void
  toMeta: (tool: CliToolOption) => CodeToolMeta
  statuses: Record<string, VersionStatus>
  installingTools: Set<string>
  upgradingTools: Set<string>
  /** Per-tool enabled-model label shown under the tool name. */
  providerSummaries: Record<string, string>
}

const SidebarStatusTag: FC<{ status?: VersionStatus; isBusy?: boolean }> = ({ status, isBusy }) => {
  const { t } = useTranslation()
  if (isBusy) {
    return (
      <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-muted-foreground/60 text-xs">
        <Loader2 className="size-2.5 motion-safe:animate-spin" />
        {t('code.installing')}
      </span>
    )
  }
  if (!status) return null
  if (!status.installed) {
    return (
      <span className="shrink-0 whitespace-nowrap text-muted-foreground/55 text-xs">{t('code.not_installed')}</span>
    )
  }
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className="truncate font-mono text-primary text-xs">
        v{status.canUpgrade && status.latest ? status.latest : status.current}
      </span>
      {status.canUpgrade && <ArrowUpCircle size={12} className="shrink-0 text-warning" />}
    </div>
  )
}

export const CodeCliSidebar: FC<CodeCliSidebarProps> = ({
  tools,
  selectedCliTool,
  onSelectTool,
  toMeta,
  statuses,
  installingTools,
  upgradingTools,
  providerSummaries
}) => {
  const { t } = useTranslation()

  return (
    <div className="flex h-full min-h-0 w-60 shrink-0 flex-col border-border/15 border-r">
      <Scrollbar className="min-h-0 flex-1 overflow-x-hidden p-2.5">
        {tools.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground/50 text-xs">{t('code.no_tools')}</div>
        ) : (
          <div className="space-y-2">
            {tools.map((tool) => {
              const meta = toMeta(tool)
              const isSelected = selectedCliTool === tool.value
              const summary = providerSummaries[tool.value]
              return (
                <button
                  key={tool.value}
                  type="button"
                  onClick={() => onSelectTool(tool.value)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                    isSelected ? 'bg-accent/55' : 'hover:bg-accent/30'
                  }`}>
                  <CLIIcon id={tool.value} size={28} className="size-7 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 items-center gap-2">
                      <div className="min-w-0 flex-1 truncate text-foreground text-sm">{meta.label}</div>
                      <SidebarStatusTag
                        status={statuses[tool.value]}
                        isBusy={installingTools.has(tool.value) || upgradingTools.has(tool.value)}
                      />
                    </div>
                    {summary && (
                      <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground/50">{summary}</div>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </Scrollbar>
    </div>
  )
}
