import { Scrollbar, SearchInput } from '@cherrystudio/ui'
import type { codeCLI } from '@shared/types/codeCli'
import { type FC, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { CLI_TOOLS } from '..'
import { CLIIcon } from './CLIIcon'
import type { CodeToolMeta } from './types'

type CliToolOption = (typeof CLI_TOOLS)[number]

export interface CodeCliSidebarProps {
  tools: readonly CliToolOption[]
  selectedCliTool: codeCLI
  onSelectTool: (tool: codeCLI) => void
  toMeta: (tool: CliToolOption) => CodeToolMeta
}

export const CodeCliSidebar: FC<CodeCliSidebarProps> = ({ tools, selectedCliTool, onSelectTool, toMeta }) => {
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
    <div className="relative h-full min-h-0 shrink-0 w-60">
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
            <div className="text-center text-xs text-muted-foreground/50 py-8">
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
                    className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-lg text-left transition-colors ${
                      isSelected ? 'bg-accent/55' : 'hover:bg-accent/30'
                    }`}>
                    <CLIIcon id={tool.value} size={28} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-foreground truncate">{meta.label}</div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-[11px] text-muted-foreground/50 truncate">
                          {t('code.tool_description.' + tool.value.replace(/-/g, '_'))}
                        </span>
                      </div>
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
