import { Button, Checkbox, Input, MenuDivider, MenuItem, Separator } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useEnsureTags, useTagList } from '@renderer/hooks/useDataTags'
import { ChevronDown, Copy, Download, Pencil, Plus, Tag, Trash2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAssistantMutationsById } from '../adapters/assistantAdapter'
import { DEFAULT_TAG_COLOR, getRandomTagColor } from '../constants'
import type { ResourceItem } from '../types'

const logger = loggerService.withContext('ResourceCardMenu')

export function canDuplicateResource(resource: ResourceItem) {
  return resource.type === 'assistant'
}

interface FixedCardMenuProps {
  x: number
  y: number
  resource: ResourceItem
  onClose: () => void
  onEdit: (r: ResourceItem) => void
  onDuplicate: (r: ResourceItem) => void
  onDelete: (r: ResourceItem) => void
  onExport: (r: ResourceItem) => void
  onUpdateResourceTags: (resourceId: string, tags: string[]) => void
  allTagNames: string[]
}

export function FixedCardMenu({
  x,
  y,
  resource,
  onClose,
  onEdit,
  onDuplicate,
  onDelete,
  onExport,
  onUpdateResourceTags,
  allTagNames
}: FixedCardMenuProps) {
  const { t } = useTranslation()
  const [showTagPicker, setShowTagPicker] = useState(false)
  const [localTags, setLocalTags] = useState<string[]>(resource.tags)
  const [tagInput, setTagInput] = useState('')
  const [bindingError, setBindingError] = useState<string | null>(null)
  const [bindingPending, setBindingPending] = useState(false)
  const bindingPendingRef = useRef(false)

  const { ensureTags } = useEnsureTags({ getDefaultColor: getRandomTagColor })
  const { updateAssistant } = useAssistantMutationsById(resource.id)
  const canBindTags = resource.type === 'assistant'

  // Backend-assigned tag color (random-from-palette at POST time): look up so
  // chip dots render consistently across Row 2, card menu, and BasicSection.
  const tagList = useTagList()
  const colorFor = (name: string): string => tagList.tags.find((tag) => tag.name === name)?.color ?? DEFAULT_TAG_COLOR

  const menuW = 150
  const menuH = 200
  const subMenuW = 170
  const clampX = Math.max(8, Math.min(x - menuW, window.innerWidth - menuW - 8))
  const clampY = Math.min(y, window.innerHeight - menuH - 8)
  const openLeft = clampX + menuW + subMenuW + 8 > window.innerWidth

  const persistTags = useCallback(
    async (nextNames: string[], previousNames: string[]) => {
      if (!canBindTags) return
      if (bindingPendingRef.current) return
      bindingPendingRef.current = true
      setBindingPending(true)
      try {
        const tags = await ensureTags(nextNames)
        const tagIds = tags.map((tag) => tag.id)
        if (resource.type === 'assistant') {
          await updateAssistant({ tagIds })
        }
        onUpdateResourceTags(resource.id, nextNames)
      } catch (e) {
        // Roll back optimistic state on failure.
        setLocalTags(previousNames)
        const message = e instanceof Error ? e.message : t('library.tag_sync_failed')
        setBindingError(message)
        // The inline error text only renders while the popup is open. Toast +
        // log so the failure stays visible after menu close and lands in
        // diagnostics either way.
        window.toast.error(message)
        logger.error('Failed to sync resource tags', e instanceof Error ? e : new Error(String(e)), {
          resourceId: resource.id,
          type: resource.type
        })
      } finally {
        bindingPendingRef.current = false
        setBindingPending(false)
      }
    },
    [canBindTags, ensureTags, updateAssistant, onUpdateResourceTags, resource.id, resource.type, t]
  )

  const toggleTag = (tag: string) => {
    if (bindingPendingRef.current) return
    const prev = localTags
    const next = prev.includes(tag) ? prev.filter((item) => item !== tag) : [...prev, tag]
    setLocalTags(next)
    setBindingError(null)
    void persistTags(next, prev)
  }

  const addNewTag = () => {
    if (bindingPendingRef.current) return
    const tag = tagInput.trim()
    if (!tag || localTags.includes(tag)) {
      setTagInput('')
      return
    }
    const prev = localTags
    const next = [...prev, tag]
    setLocalTags(next)
    setTagInput('')
    setBindingError(null)
    void persistTags(next, prev)
  }

  const subMenuPos = openLeft ? 'right-full top-0 mr-1' : 'left-full top-0 ml-1'

  return (
    <div>
      <div className="fixed inset-0 z-[500]" onClick={onClose} />
      <div
        className="fixed z-[501] min-w-[140px] rounded-xs border border-border/30 bg-popover p-1 shadow-xl"
        style={{ left: clampX, top: clampY }}>
        <MenuItem
          variant="ghost"
          size="sm"
          icon={<Pencil size={10} />}
          label={t('common.edit')}
          onClick={() => {
            onEdit(resource)
            onClose()
          }}
        />

        {canBindTags && (
          <div className="relative">
            <MenuItem
              variant="ghost"
              size="sm"
              active={showTagPicker}
              icon={<Tag size={10} />}
              label={t('library.action.manage_tags')}
              suffix={
                <>
                  {localTags.length > 0 && (
                    <span className="text-muted-foreground/40 text-xs tabular-nums">{localTags.length}</span>
                  )}
                  <ChevronDown size={8} className={`transition-transform ${showTagPicker ? 'rotate-180' : ''}`} />
                </>
              }
              onClick={() => setShowTagPicker(!showTagPicker)}
            />
            {bindingError && <p className="px-2.5 py-1 text-destructive/80 text-xs">{bindingError}</p>}
            {showTagPicker && (
              <div
                className={`absolute ${subMenuPos} flex max-h-[260px] min-w-[160px] flex-col rounded-xs border border-border/30 bg-popover p-1 shadow-xl`}>
                <div className="mb-0.5 flex items-center gap-1 px-2 py-1">
                  <Input
                    autoFocus
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') addNewTag()
                    }}
                    disabled={bindingPending}
                    placeholder={t('library.tag_picker.placeholder')}
                    className="h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-foreground text-xs shadow-none outline-none placeholder:text-muted-foreground/30 focus-visible:ring-0 disabled:opacity-50"
                  />
                  {tagInput.trim() && (
                    <Button
                      variant="ghost"
                      onClick={addNewTag}
                      disabled={bindingPending}
                      className="h-auto min-h-0 w-auto p-0 font-normal text-muted-foreground/30 shadow-none transition-colors hover:text-foreground focus-visible:ring-0 disabled:opacity-40">
                      <Plus size={10} />
                    </Button>
                  )}
                </div>
                <Separator className="mx-1 mb-0.5 bg-border/15" />
                <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar-thumb]:bg-border/30 [&::-webkit-scrollbar]:w-[2px]">
                  {allTagNames.length === 0 && !tagInput.trim() && (
                    <p className="px-2.5 py-2 text-center text-muted-foreground/40 text-xs">
                      {t('library.tag_picker.no_tags')}
                    </p>
                  )}
                  {allTagNames.map((tag) => {
                    const checked = localTags.includes(tag)
                    return (
                      <label
                        key={tag}
                        className={`flex w-full items-center gap-2 rounded-3xs px-2.5 py-[5px] text-muted-foreground/60 text-xs transition-colors ${
                          bindingPending
                            ? 'cursor-not-allowed opacity-60'
                            : 'cursor-pointer hover:bg-accent/50 hover:text-foreground'
                        }`}>
                        <Checkbox
                          size="sm"
                          checked={checked}
                          disabled={bindingPending}
                          onCheckedChange={() => toggleTag(tag)}
                          className="size-3.5 rounded-4xs border-border/30 bg-transparent shadow-none transition-colors hover:bg-transparent focus-visible:ring-0 data-[state=checked]:border-primary/70 data-[state=checked]:bg-primary/70 data-[state=checked]:text-primary-foreground [&_[data-slot=checkbox-indicator]_svg]:size-2"
                        />
                        <span
                          className="h-1.5 w-1.5 shrink-0 rounded-full"
                          style={{ backgroundColor: colorFor(tag) }}
                        />
                        <span className="flex-1 truncate text-left">{tag}</span>
                      </label>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {canDuplicateResource(resource) && (
          <MenuItem
            variant="ghost"
            size="sm"
            icon={<Copy size={10} />}
            label={t('library.action.duplicate')}
            onClick={() => {
              onDuplicate(resource)
              onClose()
            }}
          />
        )}
        {resource.type === 'assistant' && (
          <MenuItem
            variant="ghost"
            size="sm"
            icon={<Download size={10} />}
            label={t('assistants.presets.export.agent')}
            onClick={() => {
              onExport(resource)
              onClose()
            }}
          />
        )}
        <MenuDivider className="mx-1 my-0.5 bg-border/15" />
        <MenuItem
          variant="ghost"
          size="sm"
          icon={<Trash2 size={10} />}
          label={resource.type === 'skill' ? t('library.action.uninstall') : t('common.delete')}
          onClick={() => {
            onDelete(resource)
            onClose()
          }}
          className="text-destructive/70 hover:bg-destructive/10 hover:text-destructive data-[active=true]:bg-destructive/10 data-[active=true]:text-destructive"
        />
      </div>
    </div>
  )
}
