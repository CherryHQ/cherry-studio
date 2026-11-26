import type { TFunction } from 'i18next'
import { Check, LoaderCircle, MoreHorizontal, Paperclip } from 'lucide-react'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  Tooltip
} from '@cherrystudio/ui'
import type { TerminalBlockSummary } from '@shared/types/terminal'

import CopyButton from '../CopyButton'
import { terminalBlockHeaders, type TerminalBlockLayout, type terminalBlockNavigation } from './terminalBlockLayout'

function TerminalBlockDuration({ timing }: { timing: NonNullable<TerminalBlockSummary['timing']> }) {
  const { t, i18n } = useTranslation()
  const [now, setNow] = useState(Date.now)
  const startedAt = timing.kind === 'running' ? timing.startedAt : null
  useEffect(() => {
    if (startedAt === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [startedAt])
  const units = useMemo(
    () =>
      (['hour', 'minute', 'second'] as const).map(
        (unit) =>
          new Intl.NumberFormat(i18n.language, { style: 'unit', unit, unitDisplay: 'narrow', maximumFractionDigits: 3 })
      ),
    [i18n.language]
  )
  const elapsed =
    timing.kind === 'completed'
      ? Math.round(timing.durationMs)
      : Math.max(0, Math.floor((now - timing.startedAt) / 1000) * 1000)
  const values = [Math.floor(elapsed / 3600000), Math.floor(elapsed / 60000) % 60, (elapsed % 60000) / 1000]
  const text = values
    .flatMap((value, index) => (value || (elapsed === 0 && index === 2) ? [units[index].format(value)] : []))
    .join(' ')
  return (
    <Tooltip content={t('terminal.blocks.duration')}>
      <span
        role="timer"
        aria-label={t('terminal.blocks.duration')}
        className="shrink-0 whitespace-nowrap text-muted-foreground tabular-nums">
        {text}
      </span>
    </Tooltip>
  )
}

export type TerminalBlockAction =
  | 'copy_command'
  | 'copy_output'
  | 'copy_block'
  | 'attach'
  | 'rerun'
  | 'select'
  | 'find'
  | keyof ReturnType<typeof terminalBlockNavigation>
export const terminalBlockActionLabels = (t: TFunction) => ({
  copy_command: t('terminal.blocks.copy_command'),
  copy_output: t('terminal.blocks.copy_output'),
  copy_block: t('terminal.blocks.copy_block'),
  attach: t('terminal.blocks.attach'),
  rerun: t('terminal.blocks.rerun'),
  select: t('terminal.blocks.select'),
  find: t('terminal.blocks.find_in_block'),
  scroll_top: t('terminal.blocks.scroll_top'),
  scroll_bottom: t('terminal.blocks.scroll_bottom'),
  previous_block: t('terminal.blocks.previous_block'),
  next_block: t('terminal.blocks.next_block')
})
export function terminalBlockActions(
  block: TerminalBlockSummary,
  canRun: boolean,
  navigation?: ReturnType<typeof terminalBlockNavigation> | null
) {
  return (
    [
      'copy_command',
      'copy_output',
      'copy_block',
      'attach',
      'rerun',
      'select',
      'find',
      'scroll_top',
      'scroll_bottom',
      'previous_block',
      'next_block'
    ] as const
  ).map((action) => ({
    action,
    disabled:
      (action === 'copy_command' && block.command === null) ||
      (action === 'rerun' && (!canRun || block.command === null || block.status !== 'completed')) ||
      (['copy_output', 'copy_block', 'attach', 'select', 'find'].includes(action) &&
        !block.reliable &&
        block.status !== 'running') ||
      ((action === 'scroll_top' ||
        action === 'scroll_bottom' ||
        action === 'previous_block' ||
        action === 'next_block') &&
        navigation?.[action] == null),
    separator: action === 'scroll_top'
  }))
}
export function TerminalBlockControls({
  layout,
  height,
  inset = 0,
  scrollTop = 0,
  canRun,
  navigationForBlock,
  onShowMore,
  readOutput,
  onSelect,
  onFindFocus,
  onAction
}: {
  layout: TerminalBlockLayout
  height: number
  inset?: number
  scrollTop?: number
  canRun: boolean
  navigationForBlock?: (block: TerminalBlockSummary) => ReturnType<typeof terminalBlockNavigation> | null
  onShowMore?: (block: TerminalBlockSummary) => void
  readOutput: (block: TerminalBlockSummary) => Promise<string>
  onSelect?: (block: TerminalBlockSummary) => void
  onFindFocus: () => void
  onAction: (block: TerminalBlockSummary, action: TerminalBlockAction) => void
}) {
  const { t } = useTranslation()
  const labels = terminalBlockActionLabels(t)
  const [openBlock, setOpenBlock] = useState<string | null>(null)
  const openingFind = useRef(false)
  return (
    <div
      className="pointer-events-none absolute inset-x-0 z-20 overflow-hidden"
      style={{ top: inset + scrollTop, bottom: -scrollTop }}>
      {terminalBlockHeaders({ layout, height, inset, scrollTop }).map(({ run, top }) => {
        const cwd = run.block.cwd
        const actions = terminalBlockActions(run.block, canRun, navigationForBlock?.(run.block))
        const status =
          run.block.status === 'completed'
            ? t('terminal.blocks.exit', { code: run.block.exitCode })
            : run.block.status === 'running'
              ? t('terminal.blocks.running')
              : t('terminal.blocks.unknown')
        return (
          <div
            key={`${run.block.id}:${run.kind}`}
            data-terminal-block={run.block.id}
            data-menu-open={openBlock === run.block.id}
            className="group/block pointer-events-auto absolute inset-x-0 flex items-center gap-2 overflow-hidden bg-[oklch(from_var(--background)_l_c_h_/_1)] px-2 font-(family-name:--font-family) text-xs text-muted-foreground"
            style={{ top: top - inset, height: run.count * height }}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onClick={(event) => {
              if (event.target instanceof Element && !event.target.closest('button')) onSelect?.(run.block)
            }}
            onKeyDown={(event) => event.stopPropagation()}>
            <div
              aria-hidden
              className={`pointer-events-none absolute inset-x-2 top-0 border-t ${top <= inset ? 'border-transparent' : 'border-border/60'}`}
            />
            <span
              className="min-w-0 flex-1 truncate"
              style={{ fontFamily: 'var(--code-font-family)' }}
              title={cwd ?? undefined}>
              {cwd ?? t('terminal.blocks.unknown')}
            </span>
            {run.block.timing && <TerminalBlockDuration timing={run.block.timing} />}
            <span
              role="status"
              aria-label={status}
              title={status}
              className={`flex shrink-0 items-center gap-1 tabular-nums ${
                run.block.status === 'completed' && run.block.exitCode === 0
                  ? 'opacity-0 group-hover/block:opacity-100 group-focus-within/block:opacity-100 group-data-[menu-open=true]/block:opacity-100'
                  : run.block.exitCode
                    ? 'text-destructive'
                    : 'text-muted-foreground'
              }`}>
              {run.block.status === 'completed' && run.block.exitCode === 0 ? (
                <Check className="size-3" aria-hidden />
              ) : run.block.status === 'running' ? (
                <>
                  <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden />
                  {status}
                </>
              ) : (
                status
              )}
            </span>
            {!run.block.outputEmpty && (
              <div className="hidden shrink-0 items-center opacity-0 group-hover/block:opacity-100 group-focus-within/block:opacity-100 group-data-[menu-open=true]/block:opacity-100 @[480px]/terminal:flex">
                {actions
                  .filter(({ action }) => action === 'copy_output' || action === 'attach')
                  .map(({ action, disabled }) => (
                    <Button
                      key={action}
                      asChild={action === 'copy_output'}
                      size="icon-sm"
                      variant="ghost"
                      className="text-muted-foreground"
                      aria-label={labels[action]}
                      title={labels[action]}
                      disabled={disabled}
                      onClick={action === 'attach' ? () => onAction(run.block, action) : undefined}>
                      {action === 'attach' ? (
                        <Paperclip className="size-3.5" />
                      ) : (
                        <CopyButton
                          textToCopy={() => readOutput(run.block)}
                          successFeedback="icon"
                          color="inherit"
                          hoverColor="inherit"
                        />
                      )}
                    </Button>
                  ))}
              </div>
            )}
            <DropdownMenu
              onOpenChange={(open) => {
                if (open) openingFind.current = false
                setOpenBlock(open ? run.block.id : null)
              }}>
              <DropdownMenuTrigger asChild>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  className="text-muted-foreground/60 group-hover/block:text-muted-foreground group-focus-within/block:text-muted-foreground"
                  aria-label={t('common.more')}>
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onCloseAutoFocus={(event) => {
                  if (openingFind.current) {
                    event.preventDefault()
                    openingFind.current = false
                    onFindFocus()
                  }
                }}>
                {actions.map(({ action, disabled, separator }) => (
                  <Fragment key={action}>
                    {separator && <DropdownMenuSeparator />}
                    <DropdownMenuItem
                      disabled={disabled}
                      onSelect={() => {
                        openingFind.current = action === 'find'
                        onAction(run.block, action)
                      }}>
                      {labels[action]}
                    </DropdownMenuItem>
                  </Fragment>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )
      })}
      {layout.runs.flatMap((run) => {
        if (run.kind !== 'fold') return []
        const top = (run.start - layout.top) * height - scrollTop
        if (top + run.count * height <= inset || top >= layout.rows * height) return []
        return [
          <div
            key={`${run.block.id}:fold`}
            data-terminal-block={run.block.id}
            className="pointer-events-auto absolute inset-x-0 flex items-center bg-background px-2"
            style={{ top: top - inset, height: run.count * height }}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            onKeyDown={(event) => event.stopPropagation()}>
            <Button
              size="sm"
              variant="ghost"
              aria-expanded={false}
              aria-description={t('terminal.blocks.search_target', {
                command: run.block.command ?? t('terminal.blocks.command_unavailable')
              })}
              onClick={() => onShowMore?.(run.block)}>
              {t('terminal.blocks.show_more')}
            </Button>
          </div>
        ]
      })}
    </div>
  )
}
