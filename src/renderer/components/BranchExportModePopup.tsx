import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import i18n from '@renderer/i18n/resolver'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import type { BranchExportMode } from '@renderer/services/topicTreeExport'
import React, { useEffect, useState } from 'react'

export interface BranchExportModeInput {
  /** Whole-tree stats shown above the options to ground the choice */
  branchCount: number
  messageCount: number
  /** Whether the calling target can receive a file set; when false the file mode is disabled */
  supportsFileSet: boolean
}

interface ModeOptionProps {
  value: BranchExportMode
  title: string
  description: string
  selected: boolean
  disabled?: boolean
  onSelect: (mode: BranchExportMode) => void
}

const ModeOption = ({ value, title, description, selected, disabled, onSelect }: ModeOptionProps) => (
  <button
    type="button"
    aria-pressed={selected}
    data-mode={value}
    disabled={disabled}
    className={`w-full rounded-lg border p-3 text-left transition-colors ${
      disabled
        ? 'cursor-not-allowed border-[var(--color-border)] bg-[var(--color-background-muted)] opacity-60'
        : selected
          ? 'border-[var(--color-primary)] bg-[var(--color-background-secondary)]'
          : 'border-[var(--color-border)] hover:bg-[var(--color-background-secondary)]'
    }`}
    onClick={() => onSelect(value)}>
    <div className="font-medium text-sm">{title}</div>
    <div className="mt-0.5 text-[var(--color-text-secondary)] text-xs">{description}</div>
  </button>
)

const BranchExportModeContainer: React.FC<BranchExportModeInput & PopupInjectedProps<BranchExportMode | null>> = ({
  branchCount,
  messageCount,
  supportsFileSet,
  open,
  resolve
}) => {
  const [mode, setMode] = useState<BranchExportMode>('trunk')

  useEffect(() => {
    if (open) {
      setMode('trunk')
    }
  }, [open])

  const handleCancel = () => resolve(null)

  const handleConfirm = () => resolve(mode)

  return (
    <Dialog open={open} onOpenChange={(next) => (!next ? handleCancel() : undefined)}>
      <DialogContent closeOnOverlayClick={false} className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{i18n.t('export.branch.mode.title')}</DialogTitle>
        </DialogHeader>
        <p className="text-[var(--color-text-secondary)] text-sm">
          {i18n.t('export.branch.mode.stats', { branchCount, messageCount })}
        </p>
        <div className="space-y-2">
          <ModeOption
            value="trunk"
            title={i18n.t('export.branch.mode.trunk')}
            description={i18n.t('export.branch.mode.trunk_desc')}
            selected={mode === 'trunk'}
            onSelect={setMode}
          />
          <ModeOption
            value="appendix"
            title={i18n.t('export.branch.mode.appendix')}
            description={i18n.t('export.branch.mode.appendix_desc')}
            selected={mode === 'appendix'}
            onSelect={setMode}
          />
          <ModeOption
            value="files"
            title={i18n.t('export.branch.mode.files')}
            description={i18n.t('export.branch.mode.files_desc')}
            selected={mode === 'files'}
            disabled={!supportsFileSet}
            onSelect={setMode}
          />
          {!supportsFileSet && (
            <p className="text-[var(--color-text-secondary)] text-xs">{i18n.t('export.branch.mode.files_disabled')}</p>
          )}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={handleCancel}>
            {i18n.t('common.cancel')}
          </Button>
          <Button type="button" onClick={handleConfirm}>
            {i18n.t('chat.topics.export.title')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Imperative branch-export-mode chooser; resolves null when cancelled. */
const BranchExportModePopup = createPopup<BranchExportModeInput, BranchExportMode | null>(BranchExportModeContainer, {
  dismissResult: null
})

export default BranchExportModePopup
