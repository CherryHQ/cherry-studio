import { Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Markdown,
  Spinner
} from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import type { InstalledSkill } from '@shared/types/skill'
import { createFilePathHandle } from '@shared/utils/file'

async function readSkillBody(id: string): Promise<string> {
  const { rootPath } = await ipcApi.request('skill.folder.resolve', { skillId: id })
  const files = await window.api.file.listDirectoryEntries(rootPath, { recursive: false, includeDirectories: false })
  const root = files.find((file) => !file.isDirectory && file.path.split(/[\\/]/).pop()?.toLowerCase() === 'skill.md')
  if (!root) throw new Error('Missing SKILL.md')
  const { content } = await ipcApi.request('file.read', {
    handle: createFilePathHandle(root.path),
    options: { mode: 'full', encoding: 'binary' }
  })
  return new TextDecoder().decode(content)
}

export function LocalSkillDetailDialog({
  skill,
  displayName,
  onClose,
  onReturnFocus
}: {
  skill: InstalledSkill | null
  displayName?: string
  onClose: () => void
  onReturnFocus: () => void
}) {
  const { t } = useTranslation()
  const { data, error, isLoading, mutate } = useSWR(
    skill ? ['marketplace.local.detail', skill.id, skill.contentHash] : null,
    ([, id]) => readSkillBody(id),
    { revalidateOnFocus: false, shouldRetryOnError: false }
  )
  return (
    <Dialog
      open={Boolean(skill)}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}>
      <DialogContent
        className="flex h-[85vh] max-h-[calc(100vh-3rem)] flex-col gap-6 overflow-hidden rounded-3xl p-8 sm:max-w-4xl sm:p-10"
        overlayClassName="backdrop-blur-sm"
        closeLabel={t('common.close')}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          onReturnFocus()
        }}>
        <DialogHeader className="shrink-0 pr-6">
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-5 shrink-0" />
            <span className="break-all">{displayName ?? skill?.name}</span>
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 space-y-8 overflow-y-auto text-sm">
          <DialogDescription className="whitespace-pre-wrap">
            {skill?.description || t('library.skill_detail.no_description')}
          </DialogDescription>
          <div className="space-y-5">
            <h3 className="text-xs text-muted-foreground">{t('library.skill_marketplace.source_label')}</h3>
            <div className="space-y-1">
              <p>{t(skill?.source === 'marketplace' ? 'marketplace.online_source' : 'marketplace.local_source')}</p>
              {skill?.sourceUrl ? <p className="break-all text-xs text-muted-foreground">{skill.sourceUrl}</p> : null}
            </div>
          </div>
          <div className="space-y-5">
            <h3 className="text-xs text-muted-foreground">{t('library.skill_detail.body_label')}</h3>
            {isLoading ? (
              <Spinner text={t('common.loading')} />
            ) : error ? (
              <div role="alert" className="flex items-center gap-3 text-error">
                {t('library.skill_detail.file_load_failed')}
                <Button variant="outline" size="sm" onClick={() => void mutate()}>
                  {t('common.retry')}
                </Button>
              </div>
            ) : (
              <Markdown id={`marketplace-skill-${skill?.id}`}>
                {(data ?? '').replace(/^\uFEFF?---[^\S\r\n]*\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[^\S\r\n]*(?:\r?\n|$)/, '')}
              </Markdown>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
