import { Import, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  Dropzone,
  DropzoneEmptyState,
  RadioGroup,
  RadioGroupItem,
  Scrollbar
} from '@cherrystudio/ui'
import { useSkillInstall } from '@renderer/hooks/useSkills'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import type { SkillImportInput, SkillImportOutcome, SkillImportPolicy, SkillImportPreview } from '@shared/types/skill'
import { createFilePathHandle } from '@shared/utils/file'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
}

type ImportItem = SkillImportInput & { name: string }
const policies = ['skip', 'update', 'keep_both'] as const
const policyLabels = {
  skip: 'library.import_skill_dialog.skip',
  update: 'library.import_skill_dialog.update',
  keep_both: 'library.import_skill_dialog.keep_both'
} as const
const reasonLabels = {
  folder_name: 'library.import_skill_dialog.folder_name',
  identical_content: 'library.import_skill_dialog.identical_content'
} as const
const labels = {
  new: 'library.import_skill_dialog.status_new',
  conflict: 'library.import_skill_dialog.status_conflict',
  invalid: 'library.import_skill_dialog.status_invalid',
  blocked: 'library.import_skill_dialog.status_blocked',
  installed: 'library.system_skill.imported',
  updated: 'library.import_skill_dialog.updated',
  skipped: 'library.import_skill_dialog.skipped',
  error: 'agent.tasks.logs.failed'
} as const

export function ImportSkillDialog({ open, onOpenChange }: Props) {
  const { t } = useTranslation()
  const { previewImport, applyImport } = useSkillInstall()
  const [stage, setStage] = useState<'idle' | 'review' | 'done'>('idle')
  const [busy, setBusy] = useState(false)
  const busyRef = useRef(false)
  const [items, setItems] = useState<ImportItem[]>([])
  const [policy, setPolicy] = useState<SkillImportPolicy>('skip')
  const [preview, setPreview] = useState<SkillImportPreview | null>(null)
  const [outcomes, setOutcomes] = useState<SkillImportOutcome[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setStage('idle')
      setItems([])
      setPreview(null)
      setOutcomes([])
      setError(null)
      setPolicy('skip')
    }
  }, [open])

  const setWorking = (value: boolean) => {
    busyRef.current = value
    setBusy(value)
  }
  const close = () => {
    if (!busyRef.current) onOpenChange(false)
  }
  const inputPayload = (selected: ImportItem[]) => selected.map(({ id, kind, path }) => ({ id, kind, path }))
  const failure = (cause: unknown, name = t('library.type.skill')) =>
    formatErrorMessageWithPrefix(cause, t('settings.skills.installFailed', { name }))

  const scan = async (selected: ImportItem[], nextPolicy: SkillImportPolicy) => {
    setStage('review')
    setItems(selected)
    setPolicy(nextPolicy)
    setPreview(null)
    setError(null)
    setWorking(true)
    try {
      setPreview(await previewImport(inputPayload(selected), nextPolicy))
    } catch (cause) {
      setError(failure(cause))
    } finally {
      setWorking(false)
    }
  }

  const createItem = (kind: SkillImportInput['kind'], path: string, name?: string): ImportItem => ({
    id: crypto.randomUUID(),
    kind,
    path: AbsoluteFilePathSchema.parse(path),
    name: name || path.split(/[/\\]/).pop() || path
  })
  const pick = async (kind: SkillImportInput['kind']) => {
    if (busyRef.current) return
    setWorking(true)
    try {
      const selected = await window.api.file.select(
        kind === 'zip'
          ? { filters: [{ name: 'ZIP', extensions: ['zip'] }], properties: ['openFile', 'multiSelections'] }
          : { properties: ['openDirectory', 'multiSelections'] }
      )
      if (selected?.length)
        await scan(
          selected.map((file) => createItem(kind, file.path, file.name)),
          'skip'
        )
    } catch (cause) {
      setError(failure(cause))
    } finally {
      setWorking(false)
    }
  }
  const handleZipPick = () => pick('zip')
  const handleDirPick = () => pick('directory')
  const handleDroppedEntries = async (files: File[]) => {
    if (busyRef.current || !files.length) return
    setWorking(true)
    try {
      const selected: ImportItem[] = []
      for (const file of files) {
        const path = window.api.file.getPathForFile(file)
        if (!path) continue
        const metadata = await ipcApi.request(
          'file.get_metadata',
          createFilePathHandle(AbsoluteFilePathSchema.parse(path))
        )
        selected.push(createItem(metadata?.kind === 'directory' ? 'directory' : 'zip', path, file.name))
      }
      if (selected.length) await scan(selected, 'skip')
    } catch (cause) {
      setError(failure(cause))
    } finally {
      setWorking(false)
    }
  }
  const apply = async () => {
    if (busyRef.current || !preview) return
    setWorking(true)
    setError(null)
    try {
      const result = await applyImport(inputPayload(items), policy, preview.revision)
      setOutcomes(result)
      setStage('done')
      toast.success(
        t('library.import_skill_dialog.summary', {
          written: result.filter((item) => item.status === 'installed' || item.status === 'updated').length,
          skipped: result.filter((item) => item.status === 'skipped').length,
          failed: result.filter((item) => item.status === 'blocked' || item.status === 'error').length
        })
      )
    } catch (cause) {
      setError(failure(cause))
    } finally {
      setWorking(false)
    }
  }
  const writes =
    preview?.items.filter((item) => item.status === 'new' || (item.status === 'conflict' && policy !== 'skip'))
      .length ?? 0
  const plansById = new Map(preview?.items.map((item) => [item.id, item]))
  const outcomesById = new Map(outcomes.map((item) => [item.id, item]))
  const stale = outcomes.some(
    (item) => (item.status === 'error' || item.status === 'blocked') && item.code === 'stale_plan' && item.retryable
  )

  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) close()
      }}>
      <DialogContent
        className="overflow-hidden"
        closeLabel={t('common.close')}
        showCloseButton={stage === 'idle' && !busy}
        closeOnOverlayClick={!busy}
        onPointerDownOutside={(event) => busy && event.preventDefault()}>
        <div>
          <h3 className="text-lg leading-none font-semibold text-foreground">
            {t('library.import_skill_dialog.title')}
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">{t('library.import_skill_dialog.subtitle')}</p>
        </div>
        <div className="min-w-0">
          {stage === 'idle' && (
            <>
              <Dropzone
                disabled={busy}
                getFilesFromEvent={async (event) => {
                  if ('dataTransfer' in event && event.dataTransfer) {
                    return Array.from(event.dataTransfer.files)
                  }

                  if ('target' in event && event.target && 'files' in event.target) {
                    const target = event.target
                    return target.files ? Array.from(target.files) : []
                  }

                  return []
                }}
                maxFiles={0}
                multiple
                onDrop={(files, _rejections, event) => {
                  const droppedFiles =
                    'dataTransfer' in event && event.dataTransfer ? Array.from(event.dataTransfer.files) : files
                  void handleDroppedEntries(droppedFiles)
                }}
                className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-border-subtle bg-transparent p-8 text-center shadow-none transition-colors hover:border-border-strong hover:bg-accent disabled:pointer-events-none disabled:opacity-60">
                <DropzoneEmptyState>
                  <Import size={26} strokeWidth={1.2} className="mb-3 text-foreground-tertiary" />
                  <p className="mb-1 text-xs text-muted-foreground">
                    {t('library.import_skill_dialog.local.drop_hint')}
                  </p>
                  <p className="text-xs text-muted-foreground">{t('library.import_skill_dialog.local.formats')}</p>
                </DropzoneEmptyState>
              </Dropzone>

              <div className="mt-4 flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleZipPick()}
                  disabled={busy}
                  className="shrink-0">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Import size={12} />}
                  <span>{t('settings.skills.installFromZip')}</span>
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void handleDirPick()}
                  disabled={busy}
                  className="shrink-0">
                  {busy ? <Loader2 size={12} className="animate-spin" /> : <Import size={12} />}
                  <span>{t('settings.skills.installFromDirectory')}</span>
                </Button>
              </div>
            </>
          )}
          {stage !== 'idle' && (
            <>
              {stage === 'review' && (
                <RadioGroup
                  aria-label={t('library.import_skill_dialog.policy')}
                  value={policy}
                  disabled={busy}
                  onValueChange={(value) => {
                    if (!busyRef.current && policies.includes(value as SkillImportPolicy))
                      void scan(items, value as SkillImportPolicy)
                  }}>
                  <p className="text-sm">{t('library.import_skill_dialog.policy')}</p>
                  {policies.map((value) => (
                    <label key={value} className="flex items-center gap-2 text-sm">
                      <RadioGroupItem value={value} />
                      {t(policyLabels[value])}
                    </label>
                  ))}
                </RadioGroup>
              )}
              {busy && (
                <p role="status" className="mt-4 text-sm">
                  {t(
                    stage === 'review' && !preview
                      ? 'library.import_skill_dialog.scanning'
                      : 'library.import_skill_dialog.applying'
                  )}
                </p>
              )}
              <Scrollbar
                data-testid="skill-import-results"
                className="mt-4 max-h-64 w-full max-w-full min-w-0 overflow-x-hidden rounded-md border border-border-subtle bg-background-subtle/50">
                <div className="min-w-0 divide-y divide-border-subtle">
                  {items.map((item) => {
                    const plan = plansById.get(item.id)
                    const outcome = stage === 'done' ? outcomesById.get(item.id) : undefined
                    const status = outcome?.status ?? plan?.status
                    const message =
                      outcome && (outcome.status === 'error' || outcome.status === 'blocked')
                        ? outcome.message
                        : plan?.message
                    const fullMessage = message ? failure(new Error(message), item.name) : null
                    const details = [
                      outcome?.status === 'blocked'
                        ? t('library.import_skill_dialog.blocked')
                        : status
                          ? t(labels[status])
                          : '',
                      ...(stage === 'review' ? (plan?.reasons.map((reason) => t(reasonLabels[reason])) ?? []) : []),
                      ...(stage === 'review' && plan?.target
                        ? [
                            t('library.import_skill_dialog.target', {
                              name: plan.target.folderName,
                              source: plan.target.source
                            })
                          ]
                        : []),
                      ...(stage === 'review' && plan?.destinationFolder
                        ? [t('library.import_skill_dialog.destination', { name: plan.destinationFolder })]
                        : []),
                      ...(stage === 'review' && plan?.provenanceChange
                        ? [t('library.import_skill_dialog.detach', plan.provenanceChange)]
                        : []),
                      fullMessage ?? ''
                    ].filter(Boolean)
                    return (
                      <div
                        key={item.id}
                        className="min-w-0 px-3 py-2 text-xs"
                        title={
                          plan?.status === 'invalid' && fullMessage ? fullMessage : [item.name, ...details].join(': ')
                        }>
                        <div className="truncate text-foreground" title={item.name}>
                          {item.name}
                        </div>
                        {details.map((detail, index) => (
                          <div
                            key={index}
                            className="mt-0.5 min-w-0 [overflow-wrap:anywhere] break-words whitespace-normal text-foreground-tertiary">
                            {detail}
                          </div>
                        ))}
                      </div>
                    )
                  })}
                </div>
              </Scrollbar>
              <div className="mt-4 flex justify-end gap-2">
                {stage === 'review' ? (
                  <>
                    <Button variant="outline" disabled={busy} onClick={close}>
                      {t('common.cancel')}
                    </Button>
                    <Button disabled={busy || !preview} onClick={() => void apply()}>
                      {t('library.import_skill_dialog.apply', { count: writes })}
                    </Button>
                  </>
                ) : (
                  <>
                    {stale && (
                      <Button variant="outline" disabled={busy} onClick={() => void scan(items, policy)}>
                        {t('library.import_skill_dialog.retry')}
                      </Button>
                    )}
                    <Button disabled={busy} onClick={close}>
                      {t('common.close')}
                    </Button>
                  </>
                )}
              </div>
            </>
          )}
          {error && (
            <Alert type="error" showIcon message={error} className="mt-4 rounded-md px-3 py-2 text-xs shadow-none" />
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
