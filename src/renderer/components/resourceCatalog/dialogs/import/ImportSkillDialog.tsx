import { Alert, Button, Dialog, DialogContent, Dropzone, DropzoneEmptyState, Scrollbar } from '@cherrystudio/ui'
import { useSkillInstall } from '@renderer/hooks/useSkills'
import type { InstalledSkill } from '@shared/types/skill'
import { CheckCircle2, CircleAlert, FolderOpen, Loader2, Upload } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fired after successful install(s) so the parent can refetch the grid. */
  onInstalled?: () => void
}

type ImportStatus = { kind: 'idle' } | { kind: 'success'; message: string } | { kind: 'error'; message: string }
type InstallingKey = null | 'zip' | 'directory'
type ImportKind = 'zip' | 'directory'
type ImportItemStatus = 'pending' | 'installing' | 'success' | 'error'
type ImportItem = {
  id: string
  kind: ImportKind
  name: string
  path: string
  status: ImportItemStatus
  skillName?: string
  error?: string
}

/**
 * Import-config dialog for skills — local install only (ZIP file or directory
 * containing `SKILL.md`). Marketplace search lives in 设置 → Skills; the
 * library entry intentionally keeps a tighter surface.
 *
 * Drop-zone + explicit picker buttons share the same pipeline through
 * `useSkillInstall.installFromZip` / `installFromDirectory`. Cache
 * invalidation for `/skills` is handled inside the hook, so the library
 * grid refreshes automatically after each successful install.
 */
export function ImportSkillDialog({ open, onOpenChange, onInstalled }: Props) {
  const { t } = useTranslation()
  const { installFromZip, installFromDirectory } = useSkillInstall()

  const [status, setStatus] = useState<ImportStatus>({ kind: 'idle' })
  const [installing, setInstalling] = useState<InstallingKey>(null)
  const [items, setItems] = useState<ImportItem[]>([])

  // Reset transient state on open / close.
  useEffect(() => {
    if (!open) {
      setStatus({ kind: 'idle' })
      setInstalling(null)
      setItems([])
    }
  }, [open])

  const close = () => {
    if (installing) return
    onOpenChange(false)
  }

  const getInstallErrorMessage = useCallback(
    (e: unknown, fallbackName?: string) => {
      const fallback = t('settings.skills.installFailed', { name: fallbackName ?? t('library.type.skill') })
      return e instanceof Error && e.message ? e.message : fallback
    },
    [t]
  )

  const updateItem = useCallback((id: string, patch: Partial<ImportItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }, [])

  const runImportQueue = useCallback(
    async (nextItems: ImportItem[], installingKey: Exclude<InstallingKey, null>) => {
      if (installing) return
      setInstalling(installingKey)
      setStatus({ kind: 'idle' })
      setItems(nextItems)

      let successCount = 0
      let failedCount = nextItems.filter((item) => item.status === 'error').length
      let lastSkill: InstalledSkill | null = null

      try {
        for (const item of nextItems) {
          if (item.status === 'error') continue
          updateItem(item.id, { status: 'installing', error: undefined })

          try {
            const skill = item.kind === 'zip' ? await installFromZip(item.path) : await installFromDirectory(item.path)
            if (!skill) {
              throw new Error(t('settings.skills.installFailed', { name: item.name }))
            }

            lastSkill = skill
            successCount += 1
            updateItem(item.id, { status: 'success', skillName: skill.name })
          } catch (e) {
            failedCount += 1
            updateItem(item.id, { status: 'error', error: getInstallErrorMessage(e, item.name) })
          }
        }

        if (successCount > 0) onInstalled?.()

        if (failedCount > 0) {
          setStatus({
            kind: 'error',
            message: t('settings.skills.batchInstallPartialFailed', {
              failed: failedCount,
              success: successCount,
              total: nextItems.length
            })
          })
        } else if (nextItems.length === 1 && lastSkill) {
          setStatus({ kind: 'success', message: t('settings.skills.installSuccess', { name: lastSkill.name }) })
        } else {
          setStatus({
            kind: 'success',
            message: t('settings.skills.batchInstallComplete', { count: successCount })
          })
        }
      } finally {
        setInstalling(null)
      }
    },
    [getInstallErrorMessage, installFromDirectory, installFromZip, installing, onInstalled, t, updateItem]
  )

  const createImportItem = useCallback(
    (
      kind: ImportKind,
      filePath: string,
      name: string,
      index: number,
      itemStatus: ImportItemStatus = 'pending'
    ): ImportItem => ({
      id: `${Date.now()}-${index}-${filePath}`,
      kind,
      name,
      path: filePath,
      status: itemStatus
    }),
    []
  )

  const getNameFromPath = (filePath: string) => {
    const name = filePath.split(/[/\\]/).pop()
    return name || filePath
  }

  const handleZipPick = async () => {
    if (installing) return
    try {
      const selected = await window.api.file.select({
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
        properties: ['openFile', 'multiSelections']
      })
      if (!selected || selected.length === 0) return
      const zipItems = selected.map((file, index) =>
        createImportItem('zip', file.path, file.name ?? getNameFromPath(file.path), index)
      )
      await runImportQueue(zipItems, 'zip')
    } catch (e) {
      setStatus({ kind: 'error', message: getInstallErrorMessage(e) })
    }
  }

  const handleDirPick = async () => {
    if (installing) return
    try {
      const selected = await window.api.file.select({
        properties: ['openDirectory']
      })
      if (!selected || selected.length === 0) return
      const directoryItem = createImportItem(
        'directory',
        selected[0].path,
        selected[0].name ?? getNameFromPath(selected[0].path),
        0
      )
      await runImportQueue([directoryItem], 'directory')
    } catch (e) {
      setStatus({ kind: 'error', message: getInstallErrorMessage(e) })
    }
  }

  /**
   * Drag-and-drop accepts ZIP files and directories. Settings
   * page uses the same probe (`window.api.file.isDirectory`) since dropped
   * directories show up as `File` entries on Electron.
   */
  const handleDroppedEntries = async (files: File[]) => {
    if (installing) return
    if (files.length === 0) return

    try {
      const droppedItems: ImportItem[] = []

      for (const [index, file] of files.entries()) {
        const filePath = window.api.file.getPathForFile(file)
        if (!filePath) continue

        const isDirectory = await window.api.file.isDirectory(filePath)
        if (isDirectory) {
          droppedItems.push(createImportItem('directory', filePath, file.name || getNameFromPath(filePath), index))
          continue
        }

        if (file.name.toLowerCase().endsWith('.zip')) {
          droppedItems.push(createImportItem('zip', filePath, file.name || getNameFromPath(filePath), index))
          continue
        }

        droppedItems.push({
          ...createImportItem('zip', filePath, file.name || getNameFromPath(filePath), index, 'error'),
          error: t('settings.skills.invalidFormat')
        })
      }

      if (droppedItems.length === 0) return

      const installingKey = droppedItems.some((item) => item.kind === 'zip') ? 'zip' : 'directory'
      await runImportQueue(droppedItems, installingKey)
    } catch (e) {
      setStatus({ kind: 'error', message: getInstallErrorMessage(e) })
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !installing) close()
      }}>
      <DialogContent className="overflow-hidden" onPointerDownOutside={(event) => installing && event.preventDefault()}>
        {/* Header */}
        <div>
          <div>
            <h3 className="font-semibold text-foreground text-lg leading-none">
              {t('library.import_skill_dialog.title')}
            </h3>
            <p className="mt-2 text-foreground-secondary text-sm">{t('library.import_skill_dialog.subtitle')}</p>
          </div>
        </div>

        {/* Body */}
        <div>
          <Dropzone
            disabled={Boolean(installing)}
            getFilesFromEvent={async (event) => {
              if ('dataTransfer' in event && event.dataTransfer) {
                return Array.from(event.dataTransfer.files)
              }

              if ('target' in event && event.target && 'files' in event.target) {
                const target = event.target as HTMLInputElement
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
            className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-border-muted border-dashed bg-transparent p-8 text-center shadow-none transition-colors hover:border-border-hover hover:bg-accent disabled:pointer-events-none disabled:opacity-60">
            <DropzoneEmptyState>
              <Upload size={26} strokeWidth={1.2} className="mb-3 text-foreground-muted" />
              <p className="mb-1 text-foreground-secondary text-xs">
                {t('library.import_skill_dialog.local.drop_hint')}
              </p>
              <p className="text-foreground-muted text-xs">{t('library.import_skill_dialog.local.formats')}</p>
            </DropzoneEmptyState>
          </Dropzone>

          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleZipPick()}
              disabled={Boolean(installing)}
              className="shrink-0">
              {installing === 'zip' ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
              <span>{t('settings.skills.installFromZip')}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleDirPick()}
              disabled={Boolean(installing)}
              className="shrink-0">
              {installing === 'directory' ? <Loader2 size={12} className="animate-spin" /> : <FolderOpen size={12} />}
              <span>{t('settings.skills.installFromDirectory')}</span>
            </Button>
          </div>

          <ImportResultList items={items} />
          <StatusBanner status={status} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ImportResultList({ items }: { items: ImportItem[] }) {
  const { t } = useTranslation()

  if (items.length === 0) return null

  return (
    <Scrollbar
      data-testid="skill-import-results"
      className="mt-4 max-h-44 rounded-md border border-border-muted bg-background-subtle/50">
      <div className="divide-y divide-border-muted">
        {items.map((item) => (
          <div key={item.id} className="flex min-w-0 items-start gap-2 px-3 py-2 text-xs">
            <ImportItemStatusIcon status={item.status} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-foreground">{item.name}</div>
              <div className="mt-0.5 truncate text-foreground-muted">
                {item.status === 'pending' ? t('settings.skills.batchInstallQueued') : null}
                {item.status === 'installing' ? t('common.loading') : null}
                {item.status === 'success'
                  ? t('settings.skills.installSuccess', { name: item.skillName ?? item.name })
                  : null}
                {item.status === 'error' ? item.error : null}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Scrollbar>
  )
}

function ImportItemStatusIcon({ status }: { status: ImportItemStatus }) {
  if (status === 'installing') {
    return <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-foreground-muted" />
  }
  if (status === 'success') {
    return <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" />
  }
  if (status === 'error') {
    return <CircleAlert size={14} className="mt-0.5 shrink-0 text-destructive" />
  }
  return <span className="mt-1.5 size-2 shrink-0 rounded-full bg-foreground-muted" />
}

function StatusBanner({ status }: { status: ImportStatus }) {
  return (
    <AnimatePresence>
      {status.kind === 'success' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="mt-4">
          <Alert
            type="success"
            showIcon
            message={status.message}
            className="rounded-md px-3 py-2 text-xs shadow-none"
          />
        </motion.div>
      )}
      {status.kind === 'error' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="mt-4">
          <Alert type="error" showIcon message={status.message} className="rounded-md px-3 py-2 text-xs shadow-none" />
        </motion.div>
      )}
    </AnimatePresence>
  )
}
