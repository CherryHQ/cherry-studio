import { Download, MoreHorizontal, Tag, Trash2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  ConfirmDialog,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger
} from '@cherrystudio/ui'
import { useSkillMutationsById } from '@renderer/hooks/resourceCatalog'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { InstalledSkill } from '@shared/types/skill'

import { SkillTagPicker } from './SkillTagPicker'
import type { SkillLibraryTagManager } from './useSkillLibraryTags'

export function MySkillMenu({
  skill,
  name,
  manager
}: {
  skill: InstalledSkill
  name: string
  manager: SkillLibraryTagManager
}) {
  const { t } = useTranslation()
  const { uninstallSkill } = useSkillMutationsById(skill.id)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const pending = useRef(false)
  const run = async (action: () => Promise<void>) => {
    if (pending.current) return false
    pending.current = true
    setBusy(true)
    try {
      await action()
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      pending.current = false
      setBusy(false)
    }
  }
  const selected = manager.assignments[skill.id] ?? []
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label={`${t('common.more')}: ${name}`}
            className="mr-2 shrink-0 rounded-full opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 [@media(hover:none)]:opacity-100">
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-40 rounded-2xl p-1.5">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Tag className="mr-2 size-3.5" />
              {t('marketplace.manage_tags')}
              <span className="ml-auto pr-2 text-xs text-muted-foreground">{selected.length || ''}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-48 rounded-2xl p-3">
              <SkillTagPicker
                manager={manager}
                selected={selected}
                skillId={skill.id}
                onToggle={(id) => void manager.toggle(skill.id, id)}
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            onSelect={() =>
              void run(async () => {
                const data = await ipcApi.request('skill.export', { skillId: skill.id })
                await window.api.file.save(`${skill.folderName}.zip`, data, {
                  filters: [{ name: 'ZIP', extensions: ['zip'] }]
                })
              })
            }>
            <Download className="size-3.5" />
            {t('marketplace.export')}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem variant="destructive" onSelect={() => setConfirmOpen(true)}>
            <Trash2 className="size-3.5" />
            {t('common.delete')}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={(open) => {
          if (!pending.current) setConfirmOpen(open)
        }}
        title={t('common.delete')}
        description={t('marketplace.uninstall_confirm')}
        content={<p className="text-sm font-medium">{name}</p>}
        confirmText={t('common.delete')}
        cancelText={t('common.cancel')}
        destructive
        confirmLoading={busy}
        cancelDisabled={busy}
        onConfirm={() =>
          run(async () => {
            await uninstallSkill()
            setConfirmOpen(false)
          })
        }
      />
    </>
  )
}
