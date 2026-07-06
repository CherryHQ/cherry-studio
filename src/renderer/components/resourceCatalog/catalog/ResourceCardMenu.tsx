import {
  Button,
  Input,
  MenuDivider,
  MenuItem,
  MenuList,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Separator
} from '@cherrystudio/ui'
import { loggerService } from '@logger'
import { useAssistantMutationsById } from '@renderer/hooks/resourceCatalog'
import { useEnsureTags, useTagList } from '@renderer/hooks/useTags'
import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { DEFAULT_TAG_COLOR, getRandomTagColor } from '@renderer/utils/resourceCatalog'
import { Check, ChevronDown, Copy, Download, Plus, Tag, Trash2 } from 'lucide-react'
import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('ResourceCardMenu')

function canDuplicateResource(resource: ResourceItem) {
  return resource.type === 'assistant'
}

interface ResourceCardMenuProps {
  resource: ResourceItem
  onClose: () => void
  onDuplicate: (r: ResourceItem) => void
  onDelete: (r: ResourceItem) => void
  onExport: (r: ResourceItem) => void
  allTagNames: string[]
}

export function ResourceCardMenu({
  resource,
  onClose,
  onDuplicate,
  onDelete,
  onExport,
  allTagNames
}: ResourceCardMenuProps) {
  const { t } = useTranslation()
  const [showTagPicker, setShowTagPicker] = useState(false)
  const [localTag, setLocalTag] = useState<string | null>(() =>
    resource.type === 'assistant' ? (resource.tag ?? null) : null
  )
  const [tagInput, setTagInput] = useState('')
  const [bindingError, setBindingError] = useState<string | null>(null)
  const [bindingPending, setBindingPending] = useState(false)
  const bindingPendingRef = useRef(false)
  const tagOptionRefs = useRef<Array<HTMLDivElement | null>>([])
  const [activeTagIndex, setActiveTagIndex] = useState(0)

  const { ensureTags } = useEnsureTags({ getDefaultColor: getRandomTagColor })
  const { updateAssistant } = useAssistantMutationsById(resource.id)
  const canBindTags = resource.type === 'assistant'
  const canDuplicate = canDuplicateResource(resource)
  const canExport = resource.type === 'assistant'
  const hasActionsBeforeDelete = canBindTags || canDuplicate || canExport

  // Backend-assigned tag color (random-from-palette at POST time): look up so
  // chip dots render consistently across Row 2, card menu, and BasicSection.
  const tagList = useTagList()
  const colorFor = (name: string): string => tagList.tags.find((tag) => tag.name === name)?.color ?? DEFAULT_TAG_COLOR

  useEffect(() => {
    if (!showTagPicker) return
    const selectedIndex = localTag ? allTagNames.indexOf(localTag) : -1
    setActiveTagIndex(selectedIndex >= 0 ? selectedIndex : 0)
  }, [allTagNames, localTag, showTagPicker])

  const persistTag = useCallback(
    async (nextName: string | null, previousName: string | null) => {
      if (!canBindTags) return
      if (bindingPendingRef.current) return
      bindingPendingRef.current = true
      setBindingPending(true)
      try {
        const nextNames = nextName ? [nextName] : []
        const tags = await ensureTags(nextNames)
        const tagIds = tags.map((tag) => tag.id)
        if (resource.type === 'assistant') {
          await updateAssistant({ tagIds })
        }
      } catch (e) {
        // Roll back optimistic state on failure.
        setLocalTag(previousName)
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
    [canBindTags, ensureTags, updateAssistant, resource.id, resource.type, t]
  )

  const toggleTag = (tag: string) => {
    if (bindingPendingRef.current) return
    const prev = localTag
    const next = prev === tag ? null : tag
    setLocalTag(next)
    setBindingError(null)
    void persistTag(next, prev)
  }

  const focusTagOption = (index: number) => {
    setActiveTagIndex(index)
    tagOptionRefs.current[index]?.focus()
  }

  const handleTagOptionKeyDown = (e: KeyboardEvent<HTMLDivElement>, index: number, tag: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (!bindingPending) toggleTag(tag)
      return
    }

    if (allTagNames.length === 0) return

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusTagOption((index + 1) % allTagNames.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusTagOption((index - 1 + allTagNames.length) % allTagNames.length)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusTagOption(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      focusTagOption(allTagNames.length - 1)
    }
  }

  const addNewTag = () => {
    if (bindingPendingRef.current) return
    const tag = tagInput.trim()
    if (!tag || localTag === tag) {
      setTagInput('')
      return
    }
    const prev = localTag
    const next = tag
    setLocalTag(next)
    setTagInput('')
    setBindingError(null)
    void persistTag(next, prev)
  }

  return (
    <MenuList className="gap-0.5">
      {canBindTags && (
        <div>
          <Popover open={showTagPicker} onOpenChange={setShowTagPicker}>
            <PopoverTrigger asChild>
              <MenuItem
                variant="ghost"
                size="sm"
                active={showTagPicker}
                icon={<Tag size={10} />}
                label={t('library.action.manage_tags')}
                suffix={
                  <ChevronDown size={8} className={`transition-transform ${showTagPicker ? 'rotate-180' : ''}`} />
                }
              />
            </PopoverTrigger>
            <PopoverContent
              side="right"
              align="start"
              sideOffset={4}
              className="flex max-h-65 w-40 flex-col rounded-lg border-border p-1"
              onClick={(e) => e.stopPropagation()}>
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
                  className="h-auto min-w-0 flex-1 rounded-none border-0 bg-transparent p-0 text-foreground text-xs shadow-none outline-none placeholder:text-foreground-muted focus-visible:ring-0 disabled:opacity-50"
                />
                {tagInput.trim() && (
                  <Button
                    variant="ghost"
                    onClick={addNewTag}
                    disabled={bindingPending}
                    className="h-auto min-h-0 w-auto p-0 font-normal text-foreground-muted shadow-none transition-colors hover:text-foreground focus-visible:ring-0 disabled:opacity-40">
                    <Plus size={10} />
                  </Button>
                )}
              </div>
              <Separator className="mx-1 mb-0.5 bg-border-subtle" />
              <div
                role="menu"
                aria-label={t('library.config.basic.tags')}
                className="flex-1 overflow-y-auto [&::-webkit-scrollbar-thumb]:bg-border-muted [&::-webkit-scrollbar]:w-0.5">
                {allTagNames.length === 0 && !tagInput.trim() && (
                  <p className="px-2.5 py-2 text-center text-foreground-muted text-xs">
                    {t('library.tag_picker.no_tags')}
                  </p>
                )}
                {allTagNames.map((tag, index) => {
                  const checked = localTag === tag
                  return (
                    <div
                      key={tag}
                      ref={(node) => {
                        tagOptionRefs.current[index] = node
                      }}
                      role="menuitemradio"
                      aria-checked={checked}
                      tabIndex={!bindingPending && index === activeTagIndex ? 0 : -1}
                      aria-disabled={bindingPending || undefined}
                      onClick={() => toggleTag(tag)}
                      onFocus={() => setActiveTagIndex(index)}
                      onKeyDown={(e) => handleTagOptionKeyDown(e, index, tag)}
                      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-foreground-secondary text-xs transition-colors ${
                        bindingPending
                          ? 'cursor-not-allowed opacity-60'
                          : 'cursor-pointer hover:bg-accent hover:text-foreground'
                      }`}>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: colorFor(tag) }} />
                      <span className="flex-1 truncate text-left">{tag}</span>
                      {checked && <Check size={12} className="shrink-0 text-success" />}
                    </div>
                  )
                })}
              </div>
            </PopoverContent>
          </Popover>
          {bindingError && <p className="px-2.5 py-1 text-error-text text-xs">{bindingError}</p>}
        </div>
      )}

      {canDuplicate && (
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
      {canExport && (
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
      {hasActionsBeforeDelete && <MenuDivider className="mx-1 my-0.5 bg-border-subtle" />}
      <MenuItem
        variant="ghost"
        size="sm"
        icon={<Trash2 size={10} />}
        label={resource.type === 'skill' ? t('library.action.uninstall') : t('common.delete')}
        onClick={() => {
          onDelete(resource)
          onClose()
        }}
        className="text-foreground-secondary hover:bg-error-bg hover:text-error-text data-[active=true]:bg-error-bg data-[active=true]:text-error-text"
      />
    </MenuList>
  )
}
