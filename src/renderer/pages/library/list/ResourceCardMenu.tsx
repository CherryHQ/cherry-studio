import {
  Button,
  Checkbox,
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
import { useEnsureTags, useTagList } from '@renderer/hooks/useTags'
import { ChevronDown, Copy, Download, Plus, Tag, Trash2 } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useAssistantMutationsById } from '../adapters/assistantAdapter'
import { DEFAULT_TAG_COLOR, getRandomTagColor } from '../constants'
import type { ResourceItem } from '../types'

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
  onUpdateResourceTags: (resourceId: string, tags: string[]) => void
  allTagNames: string[]
}

export function ResourceCardMenu({
  resource,
  onClose,
  onDuplicate,
  onDelete,
  onExport,
  onUpdateResourceTags,
  allTagNames
}: ResourceCardMenuProps) {
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
  const canDuplicate = canDuplicateResource(resource)
  const canExport = resource.type === 'assistant'
  const hasActionsBeforeDelete = canBindTags || canDuplicate || canExport

  // Backend-assigned tag color (random-from-palette at POST time): look up so
  // chip dots render consistently across Row 2, card menu, and BasicSection.
  const tagList = useTagList()
  const colorFor = (name: string): string => tagList.tags.find((tag) => tag.name === name)?.color ?? DEFAULT_TAG_COLOR

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
                  <>
                    {localTags.length > 0 && (
                      <span className="text-foreground-muted text-xs tabular-nums">{localTags.length}</span>
                    )}
                    <ChevronDown size={8} className={`transition-transform ${showTagPicker ? 'rotate-180' : ''}`} />
                  </>
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
              <div className="flex-1 overflow-y-auto [&::-webkit-scrollbar-thumb]:bg-border-muted [&::-webkit-scrollbar]:w-0.5">
                {allTagNames.length === 0 && !tagInput.trim() && (
                  <p className="px-2.5 py-2 text-center text-foreground-muted text-xs">
                    {t('library.tag_picker.no_tags')}
                  </p>
                )}
                {allTagNames.map((tag) => {
                  const checked = localTags.includes(tag)
                  return (
                    <div
                      key={tag}
                      role="button"
                      tabIndex={bindingPending ? -1 : 0}
                      aria-disabled={bindingPending || undefined}
                      onClick={() => toggleTag(tag)}
                      onKeyDown={(e) => {
                        if (bindingPending) return
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          toggleTag(tag)
                        }
                      }}
                      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1 text-foreground-secondary text-xs transition-colors ${
                        bindingPending
                          ? 'cursor-not-allowed opacity-60'
                          : 'cursor-pointer hover:bg-accent hover:text-foreground'
                      }`}>
                      <span onClick={(e) => e.stopPropagation()}>
                        <Checkbox
                          size="sm"
                          checked={checked}
                          disabled={bindingPending}
                          onCheckedChange={() => toggleTag(tag)}
                        />
                      </span>
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: colorFor(tag) }} />
                      <span className="flex-1 truncate text-start">{tag}</span>
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
