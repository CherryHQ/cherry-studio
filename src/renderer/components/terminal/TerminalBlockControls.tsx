import type { TFunction } from 'i18next'
import { ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@cherrystudio/ui'
import type { TerminalBlockSummary } from '@shared/types/terminal'

import type { TerminalLayoutRun } from './terminalBlockLayout'

export type TerminalBlockAction = 'copy_command' | 'copy_output' | 'copy_block' | 'attach' | 'rerun' | 'select' | 'find'
export const terminalBlockActionLabels = (t: TFunction) => ({
  copy_command: t('terminal.blocks.copy_command'),
  copy_output: t('terminal.blocks.copy_output'),
  copy_block: t('terminal.blocks.copy_block'),
  attach: t('terminal.blocks.attach'),
  rerun: t('terminal.blocks.rerun'),
  select: t('terminal.blocks.select'),
  find: t('terminal.blocks.find')
})
export function terminalBlockActions(block: TerminalBlockSummary, canRun: boolean) {
  return (['copy_command', 'copy_output', 'copy_block', 'attach', 'rerun', 'select', 'find'] as const).map(
    (action) => ({
      action,
      disabled:
        (action === 'copy_command' && block.command === null) ||
        (action === 'rerun' && (!canRun || block.command === null || block.status !== 'completed')) ||
        (['copy_output', 'copy_block', 'attach', 'select', 'find'].includes(action) &&
          !block.reliable &&
          block.status !== 'running')
    })
  )
}
export function TerminalBlockControls({
  runs,
  top,
  height,
  collapsed,
  canRun,
  onToggle,
  onAction
}: {
  runs: TerminalLayoutRun[]
  top: number
  height: number
  collapsed: string[]
  canRun: boolean
  onToggle: (block: TerminalBlockSummary) => void
  onAction: (block: TerminalBlockSummary, action: TerminalBlockAction) => void
}) {
  const { t } = useTranslation()
  const labels = terminalBlockActionLabels(t)
  return (
    <>
      {runs
        .filter((run) => run.kind !== 'terminal')
        .map((run) => (
          <div
            key={`${run.block.id}:${run.kind}`}
            data-terminal-block={run.block.id}
            className="absolute inset-x-2 z-20 flex items-center gap-2 overflow-hidden bg-background font-sans text-xs text-muted-foreground"
            style={{ top: 8 + (run.start - top) * height, height: run.count * height }}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}>
            {run.kind === 'collapsed' ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-full w-full justify-start text-xs"
                onClick={() => onToggle(run.block)}
                aria-expanded={false}>
                <ChevronRight className="size-3" />
                {t('terminal.blocks.hidden_lines', { count: run.lines })}
              </Button>
            ) : (
              <>
                {!run.block.outputEmpty && (
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    className="shrink-0"
                    disabled={
                      !run.block.reliable ||
                      run.block.status !== 'completed' ||
                      !run.block.output ||
                      !run.block.end ||
                      run.block.output.x !== 0 ||
                      run.block.end.x !== 0 ||
                      run.block.output.y === run.block.end.y
                    }
                    aria-label={t(
                      collapsed.includes(run.block.id) ? 'terminal.blocks.expand' : 'terminal.blocks.collapse'
                    )}
                    aria-expanded={!collapsed.includes(run.block.id)}
                    onClick={() => onToggle(run.block)}>
                    {collapsed.includes(run.block.id) ? (
                      <ChevronRight className="size-3" />
                    ) : (
                      <ChevronDown className="size-3" />
                    )}
                  </Button>
                )}
                <span className="min-w-0 flex-1 truncate" title={run.block.cwd ?? undefined}>
                  {run.block.cwd ?? t('terminal.blocks.unknown')}
                </span>
                <span className={run.block.exitCode ? 'text-destructive' : 'text-muted-foreground'}>
                  {run.block.status === 'completed'
                    ? t('terminal.blocks.exit', { code: run.block.exitCode })
                    : run.block.status === 'running'
                      ? t('terminal.blocks.running')
                      : t('terminal.blocks.unknown')}
                </span>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" variant="ghost" aria-label={t('common.more')}>
                      <MoreHorizontal className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {terminalBlockActions(run.block, canRun).map(({ action, disabled }) => (
                      <DropdownMenuItem key={action} disabled={disabled} onSelect={() => onAction(run.block, action)}>
                        {labels[action]}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}
          </div>
        ))}
    </>
  )
}
