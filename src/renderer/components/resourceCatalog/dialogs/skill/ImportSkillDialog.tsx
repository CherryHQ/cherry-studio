import { CheckCircle2, CircleAlert, Import, Loader2, Package, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Alert,
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Dropzone,
  DropzoneEmptyState,
  Scrollbar
} from '@cherrystudio/ui'
import { useSkillInstall } from '@renderer/hooks/useSkills'
import { ipcApi } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { AbsoluteFilePathSchema } from '@shared/types/file'
import type { InstalledSkill } from '@shared/types/skill'
import { createFilePathHandle } from '@shared/utils/file'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  requireConfirmation?: boolean
}

type ImportStatus = { kind: 'idle' } | { kind: 'error'; message: string }
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
  invalid?: boolean
}

/**
 * Skill import dialog — local install only (ZIP file or directory
 * containing `SKILL.md`). Online registry search stays in the sibling
 * `SkillMarketplaceDialog`, keeping local and remote install flows separate.
 *
 * Drop-zone + explicit picker buttons share the same pipeline through
 * `useSkillInstall.installFromZip` / `installFromDirectory`. Cache
 * invalidation for `/skills` is handled inside the hook, so the library
 * grid refreshes automatically after each successful install.
 */
export function ImportSkillDialog({ open, onOpenChange, requireConfirmation = false }: Props) {
  const { t } = useTranslation()
  const { installFromZip, installFromDirectory } = useSkillInstall()

  const [status, setStatus] = useState<ImportStatus>({ kind: 'idle' })
  const [installing, setInstalling] = useState<InstallingKey>(null)
  const [items, setItems] = useState<ImportItem[]>([])
  const importing = useRef(false)

  // Reset transient state on open / close.
  useEffect(() => {
    if (!open) {
      setStatus({ kind: 'idle' })
      setInstalling(null)
      setItems([])
    }
  }, [open])

  const close = () => {
    if (importing.current) return
    onOpenChange(false)
  }

  const getInstallErrorMessage = useCallback(
    (e: unknown, fallbackName?: string) => {
      const prefix = t('settings.skills.installFailed', { name: fallbackName ?? t('library.type.skill') })
      return e instanceof Error && e.message ? formatErrorMessageWithPrefix(e, prefix) : prefix
    },
    [t]
  )

  const updateItem = useCallback((id: string, patch: Partial<ImportItem>) => {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, ...patch } : item)))
  }, [])

  const runImportQueue = useCallback(
    async (nextItems: ImportItem[], installingKey: Exclude<InstallingKey, null>) => {
      if (importing.current) return
      importing.current = true
      setInstalling(installingKey)
      setStatus({ kind: 'idle' })
      setItems(nextItems)

      let successCount = nextItems.filter((item) => item.status === 'success').length
      const preErrorCount = nextItems.filter((item) => item.status === 'error').length
      let failedCount = preErrorCount
      let lastSkill: InstalledSkill | null = null

      try {
        for (const item of nextItems) {
          if (item.status === 'error' || item.status === 'success') continue
          updateItem(item.id, { status: 'installing', error: undefined })

          try {
            const skill = item.kind === 'zip' ? await installFromZip(item.path) : await installFromDirectory(item.path)
            if (!skill) {
              failedCount += 1
              updateItem(item.id, { status: 'error', error: getInstallErrorMessage(undefined, item.name) })
              continue
            }

            lastSkill = skill
            successCount += 1
            updateItem(item.id, { status: 'success', skillName: skill.name })
          } catch (error) {
            failedCount += 1
            updateItem(item.id, { status: 'error', error: getInstallErrorMessage(error, item.name) })
          }
        }

        if (preErrorCount === nextItems.length) return

        if (failedCount > 0) {
          if (nextItems.length > 1) {
            setStatus({
              kind: 'error',
              message: t('settings.skills.batchInstallPartialFailed', {
                failed: failedCount,
                success: successCount,
                total: nextItems.length
              })
            })
          }
          return
        }

        const message =
          nextItems.length === 1 && lastSkill
            ? t('settings.skills.installSuccess', { name: lastSkill.name })
            : t('settings.skills.batchInstallComplete', { count: successCount })
        toast.success(message)
        onOpenChange(false)
      } finally {
        importing.current = false
        setInstalling(null)
      }
    },
    [getInstallErrorMessage, installFromDirectory, installFromZip, onOpenChange, t, updateItem]
  )

  const acceptItems = async (nextItems: ImportItem[], key: Exclude<InstallingKey, null>) => {
    if (importing.current) return
    if (!requireConfirmation) return runImportQueue(nextItems, key)
    setStatus({ kind: 'idle' })
    setItems((current) => {
      const paths = new Set(current.map((item) => item.path))
      return [
        ...current,
        ...nextItems.filter((item) => {
          if (paths.has(item.path)) return false
          paths.add(item.path)
          return true
        })
      ]
    })
  }

  const confirmImport = () => {
    const next = items.map((item) =>
      item.status === 'error' && !item.invalid ? { ...item, status: 'pending' as const, error: undefined } : item
    )
    void runImportQueue(next, next.some((item) => item.kind === 'zip') ? 'zip' : 'directory')
  }

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
      await acceptItems(zipItems, 'zip')
    } catch (e) {
      setStatus({ kind: 'error', message: getInstallErrorMessage(e) })
    }
  }

  const handleDirPick = async () => {
    if (installing) return
    try {
      const selected = await window.api.file.select({
        properties: ['openDirectory', 'multiSelections']
      })
      if (!selected || selected.length === 0) return
      const directoryItems = selected.map((directory, index) =>
        createImportItem('directory', directory.path, directory.name ?? getNameFromPath(directory.path), index)
      )
      await acceptItems(directoryItems, 'directory')
    } catch (e) {
      setStatus({ kind: 'error', message: getInstallErrorMessage(e) })
    }
  }

  /**
   * Drag-and-drop accepts ZIP files and directories. Settings
   * page uses the same probe (`file.get_metadata`'s `kind`) since dropped
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

        const meta = await ipcApi.request(
          'file.get_metadata',
          createFilePathHandle(AbsoluteFilePathSchema.parse(filePath))
        )
        // A `null` metadata (path unreadable / vanished — near-nil since dropped
        // paths resolve) folds into "not a directory": it falls through to the
        // filename-based zip/invalid classification below, and a genuine read
        // failure still surfaces downstream when the item is actually imported.
        if (meta?.kind === 'directory') {
          droppedItems.push(createImportItem('directory', filePath, file.name || getNameFromPath(filePath), index))
          continue
        }

        if (file.name.toLowerCase().endsWith('.zip')) {
          droppedItems.push(createImportItem('zip', filePath, file.name || getNameFromPath(filePath), index))
          continue
        }

        droppedItems.push({
          ...createImportItem('zip', filePath, file.name || getNameFromPath(filePath), index, 'error'),
          invalid: true,
          error: t('settings.skills.invalidFormat')
        })
      }

      if (droppedItems.length === 0) return

      const installingKey = droppedItems.some((item) => item.kind === 'zip') ? 'zip' : 'directory'
      await acceptItems(droppedItems, installingKey)
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
      <DialogContent
        className={`max-h-[calc(100vh-3rem)] overflow-y-auto ${requireConfirmation ? 'rounded-3xl' : ''}`}
        onPointerDownOutside={(event) => importing.current && event.preventDefault()}
        onEscapeKeyDown={(event) => importing.current && event.preventDefault()}>
        {/* Header */}
        <DialogHeader>
          <DialogTitle className="text-lg leading-none font-semibold text-foreground">
            {t('library.import_skill_dialog.title')}
          </DialogTitle>
          {!requireConfirmation ? (
            <p className="mt-2 text-sm text-muted-foreground">{t('library.import_skill_dialog.subtitle')}</p>
          ) : null}
        </DialogHeader>

        {/* Body */}
        <div className="min-w-0">
          <Dropzone
            noClick={requireConfirmation}
            noKeyboard={requireConfirmation}
            onClick={requireConfirmation ? () => void handleZipPick() : undefined}
            disabled={Boolean(installing)}
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
              <Package size={26} strokeWidth={1.2} className="mb-3 size-6 text-foreground-tertiary" />
              <p className="mb-1 text-xs text-muted-foreground">{t('library.import_skill_dialog.local.drop_hint')}</p>
              <p className="text-xs text-muted-foreground">{t('library.import_skill_dialog.local.formats')}</p>
            </DropzoneEmptyState>
          </Dropzone>

          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleZipPick()}
              disabled={Boolean(installing)}
              className="shrink-0">
              {installing === 'zip' ? <Loader2 size={12} className="animate-spin" /> : <Import size={12} />}
              <span>
                {t(
                  requireConfirmation
                    ? 'library.import_skill_dialog.local.select_zip'
                    : 'settings.skills.installFromZip'
                )}
              </span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void handleDirPick()}
              disabled={Boolean(installing)}
              className="shrink-0">
              {installing === 'directory' ? <Loader2 size={12} className="animate-spin" /> : <Import size={12} />}
              <span>
                {t(
                  requireConfirmation
                    ? 'library.import_skill_dialog.local.select_directory'
                    : 'settings.skills.installFromDirectory'
                )}
              </span>
            </Button>
          </div>

          <ImportResultList
            items={items}
            onRemove={
              requireConfirmation && !installing
                ? (id) => setItems((current) => current.filter((item) => item.id !== id))
                : undefined
            }
          />
          <StatusBanner status={status} />
        </div>
        {requireConfirmation ? (
          <DialogFooter>
            <Button variant="ghost" disabled={Boolean(installing)} onClick={close}>
              {t('common.cancel')}
            </Button>
            <Button
              disabled={
                Boolean(installing) ||
                !items.some((item) => item.status === 'pending' || (item.status === 'error' && !item.invalid))
              }
              onClick={confirmImport}>
              {installing ? <Loader2 className="size-4 animate-spin" /> : <Import className="size-4" />}
              {t(
                items.some((item) => item.status === 'error' && !item.invalid)
                  ? 'common.retry'
                  : 'marketplace.confirm_import'
              )}
            </Button>
          </DialogFooter>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function ImportResultList({ items, onRemove }: { items: ImportItem[]; onRemove?: (id: string) => void }) {
  const { t } = useTranslation()

  if (items.length === 0) return null

  return (
    <Scrollbar
      data-testid="skill-import-results"
      className="mt-4 max-h-44 w-full max-w-full min-w-0 overflow-x-hidden rounded-md border border-border-subtle bg-background-subtle/50">
      <div className="min-w-0 divide-y divide-border-subtle">
        {items.map((item) => {
          const displayName = item.status === 'success' ? (item.skillName ?? item.name) : item.name

          return (
            <div key={item.id} className="flex min-w-0 items-start gap-2 px-3 py-2 text-xs">
              <ImportItemStatusIcon status={item.status} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-foreground" title={displayName}>
                  {displayName}
                </div>
                {item.status !== 'success' ? (
                  <div
                    className="mt-0.5 min-w-0 [overflow-wrap:anywhere] break-words whitespace-normal text-foreground-tertiary"
                    title={item.status === 'error' ? item.error : undefined}>
                    {item.status === 'pending' ? t('settings.skills.batchInstallQueued') : null}
                    {item.status === 'installing' ? t('common.loading') : null}
                    {item.status === 'error' ? item.error : null}
                  </div>
                ) : null}
              </div>
              {onRemove && item.status !== 'success' ? (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`${t('common.delete')}: ${item.name}`}
                  onClick={() => onRemove(item.id)}>
                  <X className="size-3.5" />
                </Button>
              ) : null}
            </div>
          )
        })}
      </div>
    </Scrollbar>
  )
}

function ImportItemStatusIcon({ status }: { status: ImportItemStatus }) {
  if (status === 'installing') {
    return <Loader2 size={14} className="mt-0.5 shrink-0 animate-spin text-foreground-tertiary" />
  }
  if (status === 'success') {
    return <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" />
  }
  if (status === 'error') {
    return <CircleAlert size={14} className="mt-0.5 shrink-0 text-error" />
  }
  return <span className="mt-1.5 size-2 shrink-0 rounded-full border border-border-strong bg-muted" />
}

function StatusBanner({ status }: { status: ImportStatus }) {
  return (
    <AnimatePresence>
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
