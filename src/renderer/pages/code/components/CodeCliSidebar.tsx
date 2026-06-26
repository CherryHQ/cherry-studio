import { Badge, Scrollbar, SearchInput } from '@cherrystudio/ui'
import type { codeCLI } from '@shared/types/codeCli'
import { Loader2 } from 'lucide-react'
import { type FC, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { CLI_TOOLS } from '../cliTools'
import type { CodeToolMeta, VersionStatus } from '../types'
import { CLIIcon } from './CLIIcon'

type CliToolOption = (typeof CLI_TOOLS)[number]

export interface CodeCliSidebarProps {
  tools: readonly CliToolOption[]
  selectedCliTool: codeCLI
  onSelectTool: (tool: codeCLI) => void
  toMeta: (tool: CliToolOption) => CodeToolMeta
  statuses: Record<string, VersionStatus>
  installingTools: Set<string>
  upgradingTools: Set<string>
}

const SidebarStatusTag: FC<{ status?: VersionStatus; isBusy?: boolean }> = ({ status, isBusy }) => {
  const { t } = useTranslation()
  if (isBusy) {
    return (
      <Badge variant="secondary" className="gap-1 px-1.5 py-0 text-[10px] leading-4">
        <Loader2 className="size-2.5 motion-safe:animate-spin" />
        {t('code.installing')}
      </Badge>
    )
  }
  if (!status) return null
  if (!status.installed) {
    return (
      <Badge variant="outline" className="px-1.5 py-0 text-[10px] text-muted-foreground leading-4">
        {t('code.not_installed')}
      </Badge>
    )
  }
  if (status.canUpgrade) {
    return (
      <Badge variant="outline" className="gap-0.5 border-warning/50 px-1.5 py-0 text-[10px] text-warning leading-4">
        {t('code.can_upgrade')}
      </Badge>
    )
  }
  return (
    status.current && (
      <Badge variant="secondary" className="px-1.5 py-0 text-[10px] leading-4">
        v{status.current}
      </Badge>
    )
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
          tool.label.toLowerCase().includes(searchTerm.toLowerCase()) ||
          tool.value.toLowerCase().includes(searchTerm.toLowerCase())
      ),
    [tools, searchTerm]
  )

  return (
    <div className="relative h-full min-h-0 w-60 shrink-0">
      <aside className="flex size-full min-h-0 flex-col border-border-muted border-r">
        <div className="flex shrink-0 items-center gap-2 p-3">
          <div className="min-w-0 flex-1">
            <SearchInput
              value={searchTerm}
              onChange={(event) => setSearchTerm(event.target.value)}
              onClear={() => setSearchTerm('')}
              clearLabel={t('common.clear')}
              placeholder={t('code.search_cli_placeholder')}
            />
          </div>
        </div>

        <Scrollbar className="min-h-0 flex-1 overflow-x-hidden px-3 pb-3">
          {displayedTools.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground/50 text-xs">
              {searchTerm ? t('code.no_matching_tools') : t('code.no_tools')}
            </div>
          ) : (
            <div className="space-y-0.5">
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
                    <CLIIcon id={tool.value} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] text-foreground">{meta.label}</div>
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
      </aside>
    </div>
  )
}
