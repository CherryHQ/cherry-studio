import { ArrowLeft, ChevronRight } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import type { FieldValues, UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogContent, DialogTitle, Form, Scrollbar } from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

import { resourceDialogCloseButtonClassName, resourceDialogHeaderClassName } from '../components/EditDialogShared'

/**
 * One scrolling settings page with a back step instead of a tab rail. `pageKey` identifies the page
 * on screen (the main page or a sub-page) so switching pages starts at the top.
 */
export function AgentSettingsShell<TValues extends FieldValues>({
  open,
  onOpenChange,
  form,
  title,
  pageKey,
  onBack,
  rootError,
  setDialogContentElement,
  children
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  form: UseFormReturn<TValues>
  title: ReactNode
  pageKey: string
  onBack?: () => void
  rootError?: string
  setDialogContentElement: (element: HTMLDivElement | null) => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0
  }, [pageKey])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={setDialogContentElement}
        className={cn('flex h-[min(640px,80vh)] flex-col gap-0 p-0 sm:max-w-150', resourceDialogCloseButtonClassName)}>
        <Form {...form}>
          {/* Clip on the form, not DialogContent: portaled poppers (model selector) use the dialog as containing block. */}
          <form
            id="resource-edit-dialog-form"
            onSubmit={(event) => event.preventDefault()}
            className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
            <div className={cn(resourceDialogHeaderClassName, onBack && 'pl-3')}>
              {onBack ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('common.back')}
                  onClick={onBack}
                  className="shrink-0 text-muted-foreground">
                  <ArrowLeft />
                </Button>
              ) : null}
              <DialogTitle className="min-w-0 truncate text-sm">{title}</DialogTitle>
            </div>
            <Scrollbar ref={scrollContainerRef} className="min-h-0 min-w-0 flex-1 px-6 pt-4 pb-3">
              {children}
            </Scrollbar>
            <div className="flex min-h-6 shrink-0 items-center px-6 pb-4" aria-live="polite">
              {rootError ? <p className="text-destructive text-xs">{rootError}</p> : null}
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

export function SettingsGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1.5">
      <h3 className="px-1 font-normal text-muted-foreground text-xs">{title}</h3>
      <div className="rounded-xl border border-border-subtle px-4 py-1">{children}</div>
    </section>
  )
}

/** A settings row whose value is edited on its own sub-page. */
export function SettingsNavRow({ label, value, onClick }: { label: string; value?: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="-mx-2 flex min-h-11 w-[calc(100%+1rem)] items-center gap-3 rounded-lg px-2 text-left transition-colors hover:bg-foreground/[0.04] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-foreground/20">
      <span className="min-w-0 flex-1 truncate text-sm">{label}</span>
      {value ? <span className="shrink-0 text-muted-foreground text-sm">{value}</span> : null}
      <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
    </button>
  )
}
