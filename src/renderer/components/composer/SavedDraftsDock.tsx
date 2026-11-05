import { ChevronRight, Pencil, X } from 'lucide-react'
import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, ScrollArea, Tooltip } from '@cherrystudio/ui'
import { isComposerInputTokenKind } from '@renderer/utils/composerTokenPolicy'

import { excludeComposerDraftTokens } from './composerDraft'
import type { SavedDraftItem } from './useSavedDrafts'

interface SavedDraftsDockProps {
  items: SavedDraftItem[]
  onEdit: (id: string) => void
  onRemove: (id: string) => void
}

/** Dock above the input listing drafts parked with "Save as draft"; they are never sent until restored. */
export function SavedDraftsDock({ items, onEdit, onRemove }: SavedDraftsDockProps) {
  const { t } = useTranslation()
  const [isExpanded, setIsExpanded] = useState(false)
  const listId = useId()
  if (items.length === 0) return null

  return (
    <div className="relative mx-2 mb-1.5 rounded-2xl border-[0.5px] border-border bg-background/90 p-1.5 backdrop-blur">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-muted-foreground h-6 min-h-0 w-full justify-start gap-1 px-1.5 text-xs font-normal shadow-none hover:bg-transparent"
        aria-expanded={isExpanded}
        aria-controls={listId}
        onClick={() => setIsExpanded((value) => !value)}>
        {t('chat.input.saved_drafts.title', { count: items.length })}
        <ChevronRight aria-hidden className={isExpanded ? 'size-3.5 rotate-90' : 'size-3.5'} />
      </Button>
      <div id={listId} hidden={!isExpanded}>
        <ScrollArea type="auto" className="max-h-40">
          <div className="flex flex-col gap-1">
            {items.map((item) => {
              const previewText = excludeComposerDraftTokens(item.draft, (token) =>
                isComposerInputTokenKind(token.kind)
              ).text.trim()
              return (
                <div key={item.id} className="group flex items-center gap-1.5 rounded-xl bg-muted/40 px-2 py-1.5">
                  <span className="min-w-0 flex-1 line-clamp-2 text-muted-foreground text-sm">
                    {previewText || t('chat.input.saved_drafts.attachments_only')}
                  </span>
                  <div className="text-muted-foreground flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                    <Tooltip placement="top" content={t('chat.input.saved_drafts.edit')}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 shadow-none"
                        aria-label={t('chat.input.saved_drafts.edit')}
                        onClick={() => onEdit(item.id)}>
                        <Pencil className="size-4" />
                      </Button>
                    </Tooltip>
                    <Tooltip placement="top" content={t('chat.input.saved_drafts.remove')}>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        className="size-7 shadow-none"
                        aria-label={t('chat.input.saved_drafts.remove')}
                        onClick={() => onRemove(item.id)}>
                        <X className="size-4" />
                      </Button>
                    </Tooltip>
                  </div>
                </div>
              )
            })}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
