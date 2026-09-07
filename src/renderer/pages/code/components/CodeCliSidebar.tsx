import { Button, Scrollbar, Tooltip } from '@cherrystudio/ui'
import { CommandContextMenu, type CommandContextMenuExtraItem, CommandPopupMenu } from '@renderer/components/command'
import { CliIcon } from '@renderer/components/icons/CliIcon'
import SidebarShortcutIcon from '@renderer/components/icons/SidebarShortcutIcon'
import type { CodeCli } from '@shared/types/codeCli'
import { Loader2, MoreHorizontal } from 'lucide-react'
import type { FC } from 'react'
import { useTranslation } from 'react-i18next'

import type { CLI_TOOLS } from '../constants/cliTools'
import type { CodeToolMeta, VersionStatus } from '../types'

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
  isSidebarPinned: (tool: CodeCli) => boolean
  onToggleSidebar: (tool: CliToolOption) => void
}

const SidebarStatusTag: FC<{ status?: VersionStatus; isBusy?: boolean }> = ({ status, isBusy }) => {
  const { t } = useTranslation()
  if (status?.operation?.status === 'removing') {
    return <Loader2 className="size-2.5 shrink-0 text-foreground-tertiary motion-safe:animate-spin" />
  }
  if (isBusy) {
    return (
      <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] text-foreground-tertiary">
        <Loader2 className="size-2.5 motion-safe:animate-spin" />
        {t('code.installing')}
      </span>
    )
  }
  if (!status) return null
  if (!status.installed) {
    return (
      <span className="shrink-0 whitespace-nowrap text-[11px] text-foreground-tertiary">{t('code.not_installed')}</span>
    )
  }
  return null
}

export const CodeCliSidebar: FC<CodeCliSidebarProps> = ({
  tools,
  selectedCliTool,
  onSelectTool,
  toMeta,
  statuses,
  installingTools,
  upgradingTools,
  providerSummaries,
  isSidebarPinned,
  onToggleSidebar
}) => {
  const { t } = useTranslation()

  return (
    <div data-ui="code.navigation" className="flex h-full min-h-0 w-66 shrink-0 flex-col border-border-subtle border-r">
      <Scrollbar className="min-h-0 flex-1 overflow-x-hidden p-2.5">
        {tools.length === 0 ? (
          <div className="py-8 text-center text-foreground-tertiary text-xs">{t('code.no_tools')}</div>
        ) : (
          <div className="space-y-2">
            {tools.map((tool) => {
              const meta = toMeta(tool)
              const isSelected = selectedCliTool === tool.value
              const summary = providerSummaries[tool.value]
              const sidebarPinned = isSidebarPinned(tool.value)
              const canManageSidebar = statuses[tool.value]?.installed === true || sidebarPinned
              const contextMenuItems: readonly CommandContextMenuExtraItem[] = canManageSidebar
                ? [
                    {
                      type: 'item',
                      id: `code-cli.toggle-sidebar.${tool.value}`,
                      label: t(sidebarPinned ? 'miniApp.remove_from_sidebar' : 'miniApp.add_to_sidebar'),
                      icon: <SidebarShortcutIcon size={14} pinned={sidebarPinned} />,
                      onSelect: () => onToggleSidebar(tool)
                    }
                  ]
                : []
              const row = (
                <div
                  key={tool.value}
                  className={`group/row flex w-full items-center rounded-lg pr-1 transition-colors ${
                    isSelected ? 'bg-accent/55' : 'hover:bg-accent/30'
                  }`}>
                  <button
                    type="button"
                    onClick={() => onSelectTool(tool.value)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-2 py-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-ring">
                    <CliIcon id={tool.value} size={28} className="size-7 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <div className="min-w-0 flex-1 truncate text-[13px] text-foreground">{meta.label}</div>
                        <SidebarStatusTag
                          status={statuses[tool.value]}
                          isBusy={installingTools.has(tool.value) || upgradingTools.has(tool.value)}
                        />
                      </div>
                      {summary && (
                        <div className="mt-0.5 truncate font-mono text-[10px] text-foreground-tertiary">{summary}</div>
                      )}
                    </div>
                  </button>
                  {canManageSidebar && (
                    <Tooltip title={t('common.more')} delay={500}>
                      <CommandPopupMenu
                        location="webcontents.context"
                        extraItems={contextMenuItems}
                        align="end"
                        side="bottom">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('common.more')}
                          className="size-7 opacity-0 shadow-none group-focus-within/row:opacity-100 group-hover/row:opacity-100 data-[state=open]:opacity-100"
                          onClick={(event) => event.stopPropagation()}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </CommandPopupMenu>
                    </Tooltip>
                  )}
                </div>
              )
              return canManageSidebar ? (
                <CommandContextMenu key={tool.value} location="webcontents.context" extraItems={contextMenuItems}>
                  {row}
                </CommandContextMenu>
              ) : (
                row
              )
            })}
          </div>
        )}
      </Scrollbar>
    </div>
  )
}
