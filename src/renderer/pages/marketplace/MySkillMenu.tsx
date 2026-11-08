import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { ConfirmDialog } from '@cherrystudio/ui'
import { useSkillMutationsById } from '@renderer/hooks/resourceCatalog'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { InstalledSkill } from '@shared/types/skill'

import { ResourceCardMenu } from './ResourceCardMenu'
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
  return (
    <>
      <ResourceCardMenu
        name={name}
        resourceKey={skill.id}
        manager={manager}
        disabled={busy}
        onDelete={() => setConfirmOpen(true)}
        onExport={async () => {
          const data = await ipcApi.request('skill.export', { skillId: skill.id })
          await window.api.file.save(`${skill.folderName}.zip`, data, {
            filters: [{ name: 'ZIP', extensions: ['zip'] }]
          })
        }}
      />
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
