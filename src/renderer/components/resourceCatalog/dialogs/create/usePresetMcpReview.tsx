import { lazy, Suspense, useInsertionEffect, useRef, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogTitle } from '@cherrystudio/ui'

import type { ResourceCreateWizardFormValues } from './types'

const McpStep = lazy(() => import('./steps/McpStep').then((module) => ({ default: module.McpStep })))

/** Preset shortcuts must review inherited tools before they create an assistant. */
export function usePresetMcpReview() {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const resolveRef = useRef<((ids: string[] | null) => void) | null>(null)
  const form = useForm<ResourceCreateWizardFormValues>()
  const ids = useWatch({ control: form.control, name: 'reviewedMcpServerIds' })
  const finish = (value: string[] | null) => {
    resolveRef.current?.(value)
    resolveRef.current = null
    setOpen(false)
  }
  useInsertionEffect(() => () => resolveRef.current?.(null), [])
  const reviewMcp = () => {
    resolveRef.current?.(null)
    form.reset({ reviewedMcpServerIds: undefined })
    setOpen(true)
    return new Promise<string[] | null>((resolve) => {
      resolveRef.current = resolve
    })
  }
  const reviewDialog = (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) finish(null)
      }}>
      <DialogContent className="flex max-h-[85vh] flex-col overflow-hidden">
        <DialogTitle>{t('settings.mcp.title')}</DialogTitle>
        <div className="min-h-0 overflow-y-auto">
          {open ? (
            <Suspense fallback={<p role="status">{t('common.loading')}</p>}>
              <McpStep key="preset-review" form={form} active disabled={false} portalContainer={null} />
            </Suspense>
          ) : null}
        </div>
        <div className="flex shrink-0 justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => finish(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            type="button"
            disabled={ids === undefined}
            onClick={() => finish(form.getValues('reviewedMcpServerIds') ?? [])}>
            {t('library.config.dialogs.create.submit')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
  return { reviewMcp, reviewDialog }
}
