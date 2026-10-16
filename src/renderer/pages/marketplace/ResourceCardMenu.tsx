import { Copy, Download, MoreHorizontal, Pencil, Tag, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@cherrystudio/ui'
import { toast } from '@renderer/services/toast'

import { SkillTagPicker } from './SkillTagPicker'
import type { SkillLibraryTagManager } from './useSkillLibraryTags'

export function ResourceCardMenu({
  name,
  resourceKey,
  manager,
  disabled,
  onEdit,
  onExport,
  onDuplicate,
  onDelete
}: {
  name: string
  resourceKey: string
  manager: SkillLibraryTagManager
  disabled?: boolean
  onEdit?: () => void
  onExport?: () => Promise<unknown>
  onDuplicate?: () => Promise<unknown>
  onDelete?: () => void
}) {
  const { t } = useTranslation()
  const pending = useRef(false)
  const [busy, setBusy] = useState(false)
  const selected = manager.assignments[resourceKey] ?? []
  const run = async (action: () => Promise<unknown>) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    try {
      await action()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled || busy || manager.saving}
          aria-label={`${t('common.more')}: ${name}`}
          className="mr-2 shrink-0 rounded-full opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100">
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-40 rounded-2xl p-1.5">
        {onEdit ? (
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className="size-3.5" />
            {t('common.edit')}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Tag className="size-3.5" />
            {t('marketplace.manage_tags')}
            <span className="ml-auto pr-2 text-xs text-muted-foreground">{selected.length || ''}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48 rounded-2xl p-3">
            <SkillTagPicker
              manager={manager}
              selected={selected}
              resourceKey={resourceKey}
              onToggle={(id) => void manager.toggle(resourceKey, id)}
            />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {onDuplicate ? (
          <DropdownMenuItem onSelect={() => void run(onDuplicate)}>
            <Copy className="size-3.5" />
            {t('marketplace.duplicate')}
          </DropdownMenuItem>
        ) : null}
        {onExport ? (
          <DropdownMenuItem onSelect={() => void run(onExport)}>
            <Download className="size-3.5" />
            {t('marketplace.export')}
          </DropdownMenuItem>
        ) : null}
        {onDelete ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={onDelete}>
              <Trash2 className="size-3.5" />
              {t('common.delete')}
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
