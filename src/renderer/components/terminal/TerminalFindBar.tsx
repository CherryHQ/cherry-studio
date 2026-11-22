import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useEffect, useRef, type Ref } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Input } from '@cherrystudio/ui'
import type { TerminalSearchProjection } from '@shared/types/terminal'

export function TerminalFindBar({
  ref,
  needle,
  scope,
  canBlock,
  result,
  onChange,
  onNavigate,
  onClose
}: {
  ref?: Ref<HTMLDivElement>
  needle: string
  scope: 'terminal' | 'block'
  canBlock: boolean
  result: TerminalSearchProjection | null
  onChange: (needle: string, scope: 'terminal' | 'block') => void
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
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  return (
    <div
      ref={ref}
      role="search"
      aria-label={t('terminal.blocks.find')}
      className="absolute inset-x-2 top-1 z-30 flex flex-wrap items-center gap-1 rounded-md border bg-popover p-1 font-sans text-popover-foreground shadow-md"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
        if (event.key === 'Enter' && event.target === input.current) {
          event.preventDefault()
          onNavigate(event.shiftKey ? 'previous' : 'next')
        }
      }}>
      <Input
        ref={input}
        value={needle}
        onChange={(event) => onChange(event.target.value, scope)}
        aria-label={t('terminal.blocks.find')}
        className="h-7 min-w-24 flex-1 text-xs"
      />
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs"
        title={t('terminal.blocks.scope')}
        disabled={!canBlock}
        onClick={() => onChange(needle, scope === 'terminal' ? 'block' : 'terminal')}>
        {scope === 'terminal' ? t('terminal.blocks.scope_terminal') : t('terminal.blocks.scope_block')}
      </Button>
      <span role="status" className="px-1 text-xs text-muted-foreground">
        {needle && result
          ? `${result.selected ? result.selected.index + 1 : 0}/${result.count} · ${statuses[result.status]}`
          : ''}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('terminal.blocks.previous')}
        disabled={!needle}
        onClick={() => onNavigate('previous')}>
        <ChevronUp className="size-3" />
      </Button>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={t('terminal.blocks.next')}
        disabled={!needle}
        onClick={() => onNavigate('next')}>
        <ChevronDown className="size-3" />
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={t('common.close')} onClick={onClose}>
        <X className="size-3" />
      </Button>
      {(result?.partial || result?.highlightsLimited) && (
        <span className="w-full px-1 text-xs text-warning">{t('terminal.blocks.partial')}</span>
      )}
    </div>
  )
}
