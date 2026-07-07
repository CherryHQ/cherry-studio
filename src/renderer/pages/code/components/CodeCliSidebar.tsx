import { Scrollbar, SearchInput } from '@cherrystudio/ui'
import type { CodeCli } from '@shared/types/codeCli'
import { ArrowUpCircle, Loader2 } from 'lucide-react'
import { type FC, useMemo, useState } from 'react'
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
}

const SidebarStatusTag: FC<{ status?: VersionStatus; isBusy?: boolean }> = ({ status, isBusy }) => {
  const { t } = useTranslation()
  if (isBusy) {
    return (
      <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground/60">
        <Loader2 className="size-2.5 motion-safe:animate-spin" />
        {t('code.installing')}
      </span>
    )
  }
  if (!status) return null
  if (!status.installed) {
    return (
      <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground/55">{t('code.not_installed')}</span>
    )
  }
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <span className="truncate font-mono text-[11px] text-primary">
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
  upgradingTools
}) => {
  const { t } = useTranslation()
  const [searchTerm, setSearchTerm] = useState('')

  const displayedTools = useMemo(
    () =>
      tools.filter(
        (tool) =>
          t(tool.label).toLowerCase().includes(searchTerm.toLowerCase()) ||
          tool.value.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    [tools, searchTerm, t]
  )

  return (
    <div className="flex h-full min-h-0 w-60 shrink-0 flex-col border-border/15 border-r">
      <div className="p-2.5 pb-0">
        <SearchInput
          value={searchTerm}
          onChange={(event) => setSearchTerm(event.target.value)}
          onClear={() => setSearchTerm('')}
          clearLabel={t('common.clear')}
          placeholder={t('code.search_cli_placeholder')}
        />
      </div>

      <Scrollbar className="min-h-0 flex-1 overflow-x-hidden p-2">
        {displayedTools.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground/50 text-xs">
            {searchTerm ? t('code.no_matching_tools') : t('code.no_tools')}
          </div>
        ) : (
          <div className="space-y-2">
            {displayedTools.map((tool) => {
              const meta = toMeta(tool)
              const isSelected = selectedCliTool === tool.value
              return (
                <button
                  key={tool.value}
                  type="button"
                  onClick={() => onSelectTool(tool.value)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors ${
                    isSelected ? 'bg-accent/55' : 'hover:bg-accent/30'
                  }`}>
                  <CLIIcon id={tool.value} size={28} className="size-7 shrink-0" />
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <div className="min-w-0 flex-1 truncate text-[13px] text-foreground">{meta.label}</div>
                    <SidebarStatusTag
                      status={statuses[tool.value]}
                      isBusy={installingTools.has(tool.value) || upgradingTools.has(tool.value)}
                    />
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
