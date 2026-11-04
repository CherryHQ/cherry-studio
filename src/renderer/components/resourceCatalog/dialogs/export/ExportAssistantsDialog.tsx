import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  EmptyState,
  Input,
  Scrollbar
} from '@cherrystudio/ui'
import type { Assistant } from '@shared/data/types/assistant'

type ExportAssistantsDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  assistants: readonly Assistant[]
  loading: boolean
  exporting: boolean
  onExport: (assistantIds: readonly string[]) => Promise<void>
}

export function ExportAssistantsDialog({
  open,
  onOpenChange,
  assistants,
  loading,
  exporting,
  onExport
}: ExportAssistantsDialogProps) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [search, setSearch] = useState('')
  const initialized = useRef(false)

  useEffect(() => {
    if (!open) {
      initialized.current = false
      setSelected(new Set())
      setSearch('')
    } else if (!loading && !initialized.current) {
      initialized.current = true
      setSelected(new Set(assistants.map(({ id }) => id)))
    }
  }, [assistants, loading, open])

  const query = search.toLowerCase()
  const visible = assistants.filter(
    (assistant) => assistant.name.toLowerCase().includes(query) || assistant.description.toLowerCase().includes(query)
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('assistants.presets.export.title')}</DialogTitle>
        </DialogHeader>
        <Input
          aria-label={t('common.search')}
          placeholder={t('library.toolbar.search_placeholder')}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          disabled={loading || exporting}
        />
        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={loading || exporting}
            onClick={() => setSelected(new Set(assistants.map(({ id }) => id)))}>
            {t('common.select_all')}
          </Button>
          <Button variant="ghost" size="sm" disabled={loading || exporting} onClick={() => setSelected(new Set())}>
            {t('assistants.presets.export.deselect_all')}
          </Button>
          <span className="ml-auto text-sm text-muted-foreground" aria-live="polite">
            {t('common.selectedItems', { count: selected.size })}
          </span>
        </div>
        <Scrollbar className="h-80">
          {loading ? (
            <p role="status" className="p-4 text-sm text-muted-foreground">
              {t('common.loading')}
            </p>
          ) : visible.length === 0 ? (
            <EmptyState preset="no-result" title={t('common.no_results')} />
          ) : (
            visible.map((assistant) => (
              <label
                key={assistant.id}
                className="flex cursor-pointer items-start gap-3 rounded-md p-3 hover:bg-accent focus-within:bg-accent">
                <Checkbox
                  aria-label={assistant.name}
                  checked={selected.has(assistant.id)}
                  disabled={exporting}
                  onCheckedChange={(checked) =>
                    setSelected((previous) => {
                      const next = new Set(previous)
                      if (checked === true) next.add(assistant.id)
                      else next.delete(assistant.id)
                      return next
                    })
                  }
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-foreground">{assistant.name}</span>
                  {assistant.description && (
                    <span className="block line-clamp-2 text-sm text-muted-foreground">{assistant.description}</span>
                  )}
                </span>
              </label>
            ))
          )}
        </Scrollbar>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            disabled={selected.size === 0 || loading || exporting}
            loading={exporting}
            onClick={() => void onExport([...selected])}>
            {t('assistants.presets.export.action')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
