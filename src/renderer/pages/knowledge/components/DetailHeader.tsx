import { Badge, Button, MenuItem, MenuList, Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { formatRelativeTime } from '@renderer/utils/time'
import type { KnowledgeBase, KnowledgeItemType } from '@shared/data/types/knowledge'
import { FlaskConical, Plus, SlidersHorizontal } from 'lucide-react'
import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { KNOWLEDGE_DATA_SOURCE_TYPES } from './addKnowledgeItemDialog/constants'
import { statusBadgeClassNames } from './statusStyles'

interface DetailHeaderProps {
  base: KnowledgeBase
  onOpenRagConfig: () => void
  onOpenRecallTest: () => void
  onRebuild: () => void
  onAddSource: (source: KnowledgeItemType) => void
}

const DetailHeader = ({ base, onOpenRagConfig, onOpenRecallTest, onRebuild, onAddSource }: DetailHeaderProps) => {
  const { t, i18n } = useTranslation()
  const [isSourceMenuOpen, setIsSourceMenuOpen] = useState(false)

  const statusLabelKey = `knowledge.status.${base.status}` as const
  const statusLabel = t(statusLabelKey)

  const handleSourceSelect = useCallback(
    (source: KnowledgeItemType) => {
      setIsSourceMenuOpen(false)
      onAddSource(source)
    },
    [onAddSource]
  )

  return (
    <header className="shrink-0 px-3 pt-3.5 pb-2">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="min-w-0 truncate font-[550] text-foreground text-xl leading-7">{base.name}</h1>
            {base.status === 'failed' ? (
              <Button
                type="button"
                variant="ghost"
                onClick={onRebuild}
                aria-label={`${statusLabel}, ${t('knowledge.restore.action')}`}
                title={t('knowledge.restore.action')}
                className="h-auto min-h-0 shrink-0 cursor-pointer rounded-full p-0 shadow-none transition-opacity hover:bg-transparent hover:opacity-80">
                <Badge variant="outline" className={statusBadgeClassNames[base.status]}>
                  {statusLabel}
                </Badge>
              </Button>
            ) : (
              <Badge
                variant="outline"
                className={`${statusBadgeClassNames[base.status]} shrink-0`}
                aria-label={statusLabel}
                title={statusLabel}>
                {statusLabel}
              </Badge>
            )}
            <span className="shrink-0 text-foreground-muted text-xs">
              {t('knowledge.meta.updated_at', { time: formatRelativeTime(base.updatedAt, i18n.language) })}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Popover open={isSourceMenuOpen} onOpenChange={setIsSourceMenuOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-haspopup="menu"
                aria-expanded={isSourceMenuOpen}
                className="min-h-0 rounded-lg px-3 py-1.5 text-foreground/80 shadow-none hover:bg-accent hover:text-foreground [&_svg]:[stroke-width:1.6]">
                <Plus className="size-3.5" />
                {t('knowledge.data_source.toolbar.add')}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              side="bottom"
              sideOffset={8}
              collisionPadding={8}
              className="w-[var(--radix-popover-trigger-width)] rounded-xl p-1.5"
              onOpenAutoFocus={(event) => event.preventDefault()}
              onCloseAutoFocus={(event) => event.preventDefault()}>
              <MenuList role="menu" className="gap-1">
                {KNOWLEDGE_DATA_SOURCE_TYPES.map((source) => (
                  <MenuItem
                    key={source.value}
                    role="menuitem"
                    variant="ghost"
                    label={t(source.labelKey)}
                    className="h-8 rounded-lg px-2.5 text-sm"
                    onClick={() => handleSourceSelect(source.value)}
                  />
                ))}
              </MenuList>
            </PopoverContent>
          </Popover>
          {base.status !== 'failed' && (
            <>
              <Button type="button" variant="ghost" size="sm" onClick={onOpenRecallTest}>
                <FlaskConical size={14} />
                {t('knowledge.tabs.recall_test')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('knowledge.tabs.rag_config')}
                onClick={onOpenRagConfig}>
                <SlidersHorizontal size={14} strokeWidth={1.6} />
              </Button>
            </>
          )}
        </div>
      </div>
    </header>
  )
}

export default DetailHeader
