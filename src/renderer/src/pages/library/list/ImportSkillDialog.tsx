import { Button, Dialog, DialogContent } from '@cherrystudio/ui'
import type { InstalledSkill } from '@types'
import { AlertCircle, CheckCircle2, FolderOpen, Loader2, Upload, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { ChangeEvent, DragEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useSkillMutations } from '../adapters/skillAdapter'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Fired after each successful install so the parent can refetch the grid. */
  onInstalled?: () => void
}

type ImportStatus = { kind: 'idle' } | { kind: 'success'; message: string } | { kind: 'error'; message: string }
type InstallingKey = null | 'zip' | 'directory'

const AUTO_CLOSE_DELAY_MS = 1200

/**
 * Import-config dialog for skills — local install only (ZIP file or directory
 * containing `SKILL.md`). Marketplace search lives in 设置 → Skills; the
 * library entry intentionally keeps a tighter surface.
 *
 * Drop-zone + explicit picker buttons share the same pipeline through
 * `useSkillMutations.installFromZip` / `installFromDirectory`. Cache
 * invalidation for `/skills` is handled inside the adapter, so the library
 * grid refreshes automatically after each successful install.
 */
export function ImportSkillDialog({ open, onOpenChange, onInstalled }: Props) {
  const { t } = useTranslation()
  const { installFromZip, installFromDirectory } = useSkillMutations()

  const [dragOver, setDragOver] = useState(false)
  const [status, setStatus] = useState<ImportStatus>({ kind: 'idle' })
  const [installing, setInstalling] = useState<InstallingKey>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Reset transient state on open / close.
  useEffect(() => {
    if (!open) {
      setDragOver(false)
      setStatus({ kind: 'idle' })
      setInstalling(null)
    }
  }, [open])

  const close = () => {
    if (installing) return
    onOpenChange(false)
  }

  const finishInstall = (skill: InstalledSkill) => {
    setStatus({ kind: 'success', message: t('settings.skills.installSuccess', { name: skill.name }) })
    onInstalled?.()
    setTimeout(() => onOpenChange(false), AUTO_CLOSE_DELAY_MS)
  }

  const failInstall = (e: unknown, fallbackName?: string) => {
    const fallback = t('settings.skills.installFailed', { name: fallbackName ?? t('library.type.skill') })
    const message = e instanceof Error && e.message ? e.message : fallback
    setStatus({ kind: 'error', message })
    window.toast.error(message)
  }

  const handleZipPick = async () => {
    if (installing) return
    const selected = await window.api.file.select({
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
      properties: ['openFile']
    })
    if (!selected || selected.length === 0) return
    setInstalling('zip')
    setStatus({ kind: 'idle' })
    try {
      const skill = await installFromZip(selected[0].path)
      finishInstall(skill)
    } catch (e) {
      failInstall(e)
    } finally {
      setInstalling(null)
    }
  }

  const handleDirPick = async () => {
    if (installing) return
    const selected = await window.api.file.select({
      properties: ['openDirectory']
    })
    if (!selected || selected.length === 0) return
    setInstalling('directory')
    setStatus({ kind: 'idle' })
    try {
      const skill = await installFromDirectory(selected[0].path)
      finishInstall(skill)
    } catch (e) {
      failInstall(e)
    } finally {
      setInstalling(null)
    }
  }

  /**
   * Drag-and-drop accepts either a single ZIP or a single directory. Settings
   * page uses the same probe (`window.api.file.isDirectory`) since dropped
   * directories show up as `File` entries on Electron.
   */
  const handleDrop = async (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    if (installing) return
    const file = event.dataTransfer.files?.[0]
    if (!file) return

    const filePath = window.api.file.getPathForFile(file)
    if (!filePath) return

    const isDirectory = await window.api.file.isDirectory(filePath)
    setStatus({ kind: 'idle' })

    if (isDirectory) {
      setInstalling('directory')
      try {
        const skill = await installFromDirectory(filePath)
        finishInstall(skill)
      } catch (e) {
        failInstall(e, file.name)
      } finally {
        setInstalling(null)
      }
      return
    }

    if (file.name.toLowerCase().endsWith('.zip')) {
      setInstalling('zip')
      try {
        const skill = await installFromZip(filePath)
        finishInstall(skill)
      } catch (e) {
        failInstall(e, file.name)
      } finally {
        setInstalling(null)
      }
      return
    }

    setStatus({ kind: 'error', message: t('settings.skills.invalidFormat') })
  }

  // Hidden file input lets the drop-zone act as a button without going through
  // the Electron picker (drag-drop reuses the same path).
  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (installing) return
    const filePath = window.api.file.getPathForFile(file)
    if (!filePath) return
    setInstalling('zip')
    setStatus({ kind: 'idle' })
    try {
      const skill = await installFromZip(filePath)
      finishInstall(skill)
    } catch (e) {
      failInstall(e, file.name)
    } finally {
      setInstalling(null)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v && !installing) close()
      }}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/40 backdrop-blur-sm"
        className="w-[480px] gap-0 overflow-hidden rounded-xs border-border/30 bg-popover p-0 shadow-2xl sm:max-w-[480px]">
        {/* Header */}
        <div className="flex items-center justify-between border-border/15 border-b px-5 py-4">
          <div>
            <h3 className="text-foreground text-sm">{t('library.import_skill_dialog.title')}</h3>
            <p className="mt-0.5 text-muted-foreground/55 text-xs">{t('library.import_skill_dialog.subtitle')}</p>
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={close}
            disabled={Boolean(installing)}
            className="flex h-6 min-h-0 w-6 items-center justify-center rounded-3xs font-normal text-muted-foreground/40 shadow-none transition-colors hover:bg-accent/40 hover:text-foreground focus-visible:ring-0 disabled:cursor-not-allowed disabled:opacity-40">
            <X size={14} />
          </Button>
        </div>

        {/* Body */}
        <div className="px-5 py-5">
          <div
            role="button"
            tabIndex={0}
            onDragOver={(e) => {
              e.preventDefault()
              if (!installing) setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => void handleDrop(e)}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileInputRef.current?.click()
              }
            }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-2xs border-2 border-dashed p-8 transition-all ${
              dragOver ? 'border-primary/40 bg-primary/5' : 'border-border/20 hover:border-border/40 hover:bg-accent/10'
            } ${installing ? 'pointer-events-none opacity-60' : ''}`}>
            <Upload size={26} strokeWidth={1.2} className="mb-3 text-muted-foreground/35" />
            <p className="mb-1 text-muted-foreground/60 text-xs">{t('library.import_skill_dialog.local.drop_hint')}</p>
            <p className="text-muted-foreground/40 text-xs">{t('library.import_skill_dialog.local.formats')}</p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".zip,application/zip"
            className="hidden"
            onChange={(e) => void handleFileSelected(e)}
          />

          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => void handleZipPick()}
              disabled={Boolean(installing)}
              className="flex h-auto min-h-0 items-center gap-1.5 rounded-3xs border border-border/30 px-3 py-1.5 font-normal text-foreground text-xs shadow-none transition-colors hover:bg-accent/40 focus-visible:ring-0 disabled:opacity-40">
              {installing === 'zip' ? <Loader2 size={11} className="animate-spin" /> : <Upload size={11} />}
              <span>{t('settings.skills.installFromZip')}</span>
            </Button>
            <Button
              variant="ghost"
              onClick={() => void handleDirPick()}
              disabled={Boolean(installing)}
              className="flex h-auto min-h-0 items-center gap-1.5 rounded-3xs border border-border/30 px-3 py-1.5 font-normal text-foreground text-xs shadow-none transition-colors hover:bg-accent/40 focus-visible:ring-0 disabled:opacity-40">
              {installing === 'directory' ? <Loader2 size={11} className="animate-spin" /> : <FolderOpen size={11} />}
              <span>{t('settings.skills.installFromDirectory')}</span>
            </Button>
          </div>

          <StatusBanner status={status} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function StatusBanner({ status }: { status: ImportStatus }) {
  return (
    <AnimatePresence>
      {status.kind === 'success' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="mt-4 flex items-center gap-2 rounded-3xs border border-primary/20 bg-primary/10 px-3 py-2">
          <CheckCircle2 size={12} className="text-primary" />
          <span className="text-foreground text-xs">{status.message}</span>
        </motion.div>
      )}
      {status.kind === 'error' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="mt-4 flex items-center gap-2 rounded-3xs border border-destructive/20 bg-destructive/10 px-3 py-2">
          <AlertCircle size={12} className="text-destructive" />
          <span className="text-destructive text-xs">{status.message}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
