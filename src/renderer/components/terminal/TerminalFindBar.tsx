import { Scan } from 'lucide-react'
import { useEffect, useRef, type Ref } from 'react'
import { useTranslation } from 'react-i18next'

import { Tooltip } from '@cherrystudio/ui'
import ActionIconButton from '@renderer/components/ActionIconButton'
import { FindBarControls } from '@renderer/components/FindBar'
import type { TerminalBlockSummary, TerminalSearchProjection } from '@shared/types/terminal'

export function TerminalFindBar({
  ref,
  needle,
  target,
  result,
  onChange,
  onToggleScope,
  onNavigate,
  onClose
}: {
  ref?: Ref<HTMLDivElement>
  needle: string
  target: { kind: 'terminal' | 'block'; block: TerminalBlockSummary | null }
  result: TerminalSearchProjection | null
  onChange: (needle: string) => void
  onToggleScope?: () => void
  onNavigate: (direction: 'next' | 'previous') => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const statuses = {
    searching: t('terminal.blocks.search_searching'),
    'caught-up': t('terminal.blocks.search_caught-up'),
    limited: t('terminal.blocks.search_limited'),
    unavailable: t('terminal.blocks.search_unavailable'),
    capacity: t('terminal.blocks.search_capacity'),
    failed: t('terminal.blocks.search_failed')
  }
  const input = useRef<HTMLInputElement>(null)
  const targetLabel = target.block
    ? t('terminal.blocks.search_target', {
        command: target.block.command ?? t('terminal.blocks.command_unavailable')
      })
    : t(target.kind === 'block' ? 'terminal.blocks.unavailable' : 'terminal.blocks.find_in_block')
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  return (
    <div
      ref={ref}
      role="search"
      aria-label={t(target.kind === 'terminal' ? 'terminal.blocks.scope_terminal' : 'terminal.blocks.find_in_block')}
      className="pointer-events-auto absolute top-2 right-2 z-30 flex w-[26rem] max-w-[calc(100%-1rem)] flex-col gap-1 rounded-[10px] bg-popover font-sans text-popover-foreground shadow-md"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}>
      <FindBarControls
        inputRef={input}
        query={needle}
        onQueryChange={onChange}
        matchCount={needle ? (result?.count ?? 0) : 0}
        currentIndex={result?.selected?.index ?? -1}
        status={needle && result ? statuses[result.status] : undefined}
        onNavigate={(delta) => onNavigate(delta === 1 ? 'next' : 'previous')}
        onClose={onClose}>
        {onToggleScope && (
          <Tooltip content={targetLabel}>
            <ActionIconButton
              icon={<Scan size={18} />}
              aria-label={t('terminal.blocks.find_in_block')}
              aria-description={targetLabel}
              aria-pressed={target.kind === 'block'}
              active={target.kind === 'block'}
              disabled={target.kind === 'terminal' && !target.block}
              className={target.kind === 'block' ? 'rounded-md bg-accent' : 'rounded-md'}
              onClick={onToggleScope}
            />
          </Tooltip>
        )}
      </FindBarControls>
      {needle && result && result.status !== 'searching' && result.status !== 'caught-up' && (
        <span className="px-3 pb-1 text-xs text-warning">{statuses[result.status]}</span>
      )}
      {(result?.partial || result?.highlightsLimited) && (
        <span className="w-full px-3 pb-1 text-xs text-warning">{t('terminal.blocks.partial')}</span>
      )}
    </div>
  )
}
