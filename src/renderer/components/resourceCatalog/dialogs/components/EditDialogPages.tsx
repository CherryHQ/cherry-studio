import { ChevronLeft, ChevronRight } from 'lucide-react'
import { type ReactNode, useEffect, useRef } from 'react'
import { type FieldValues, type UseFormReturn } from 'react-hook-form'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Dialog,
  DialogContent,
  DialogTitle,
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
  Input
} from '@cherrystudio/ui'
import { cn } from '@cherrystudio/ui/lib/utils'

import {
  resourceDialogCloseButtonClassName,
  resourceDialogHeaderClassName,
  resourceDialogTitleClassName
} from './EditDialogShared'

/** The pill look shared by More settings' drill-in links and compact selects. */
export const settingsPillClassName =
  'h-8 max-w-56 justify-between gap-1.5 rounded-lg border-0 bg-muted/50 px-2.5 font-normal text-[13px] text-foreground shadow-none hover:bg-muted aria-expanded:bg-muted'

const inlineInputClassName =
  'h-auto rounded-lg border-transparent bg-transparent px-2 text-center shadow-none hover:bg-muted/50 focus-visible:border-transparent focus-visible:bg-muted/50 focus-visible:ring-0 dark:bg-transparent dark:hover:bg-muted/50 dark:focus-visible:bg-muted/50'

/**
 * Narrow paged edit dialog: a header with the page title (and a back button off the main page) above
 * one scrolling page. `fill` gives the dialog a fixed height for pages that stretch, such as Memory.
 */
export function EditDialogPageShell<TValues extends FieldValues>({
  open,
  onOpenChange,
  form,
  page,
  title,
  onBack,
  rootError,
  setDialogContentElement,
  fill = false,
  children
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  form: UseFormReturn<TValues>
  /** The current page's id; a change scrolls back to the top. */
  page: string
  title: string
  onBack?: () => void
  rootError?: string
  setDialogContentElement: (element: HTMLDivElement | null) => void
  fill?: boolean
  children: ReactNode
}) {
  const { t } = useTranslation()
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [page])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={setDialogContentElement}
        className={cn(
          'flex max-h-[min(720px,88vh)] flex-col gap-0 p-0 sm:max-w-120',
          fill && 'h-[min(720px,88vh)]',
          resourceDialogCloseButtonClassName
        )}>
        <Form {...form}>
          {/* Clipping lives on the form, not DialogContent: the dialog's transform makes it the
              containing block for portaled fixed poppers, which overflow-hidden would clip. */}
          <form
            id="resource-edit-dialog-form"
            onSubmit={(event) => event.preventDefault()}
            className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[inherit]">
            <div className={resourceDialogHeaderClassName}>
              {onBack ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('common.back')}
                  onClick={onBack}
                  className="-my-1 -ml-2 size-6 min-h-0 rounded-md text-muted-foreground shadow-none hover:bg-accent hover:text-foreground">
                  <ChevronLeft className="size-4" />
                </Button>
              ) : null}
              <DialogTitle className={resourceDialogTitleClassName}>{title}</DialogTitle>
            </div>
            <div
              ref={scrollRef}
              className={cn('min-h-0 flex-1 overflow-y-auto px-6 pt-6 pb-2', fill && 'flex flex-col')}>
              {children}
            </div>
            <div className="flex min-h-5 shrink-0 items-center px-6 pb-3" aria-live="polite">
              {rootError ? <p className="text-destructive text-xs">{rootError}</p> : null}
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * The main page: a large avatar, the name and description as borderless inputs, then the model
 * and the way into More settings. The name is required and an empty one shows the message.
 */
export function EditMainPage({
  form,
  avatar,
  namePlaceholder,
  descriptionPlaceholder,
  model,
  onOpenMore
}: {
  form: UseFormReturn<any>
  avatar: ReactNode
  namePlaceholder: string
  descriptionPlaceholder: string
  model: ReactNode
  onOpenMore: () => void
}) {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col items-center">
        {avatar}
        <FormField
          control={form.control}
          name="name"
          rules={{ validate: (value: string) => value.trim().length > 0 || t('common.required_field') }}
          render={({ field }) => (
            <FormItem className="mt-3 w-full gap-1">
              <FormControl>
                <Input
                  {...field}
                  aria-label={t('common.name')}
                  placeholder={namePlaceholder}
                  className={cn(inlineInputClassName, 'h-9 font-semibold text-lg md:text-lg')}
                />
              </FormControl>
              <FormMessage className="text-center text-xs" />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem className="w-full">
              <FormControl>
                <Input
                  {...field}
                  aria-label={t('common.description')}
                  placeholder={descriptionPlaceholder}
                  className={cn(inlineInputClassName, 'h-7 text-[13px] text-muted-foreground md:text-[13px]')}
                />
              </FormControl>
            </FormItem>
          )}
        />
      </div>
      <div className="flex items-center gap-1.5">
        <div className="min-w-0">{model}</div>
        <div className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onOpenMore}
          className="h-8 min-h-0 shrink-0 gap-0.5 rounded-lg px-2 font-normal text-muted-foreground text-sm shadow-none hover:bg-muted/50 hover:text-foreground">
          {t('library.config.dialogs.edit.page.more')}
          <ChevronRight className="size-3.5" />
        </Button>
      </div>
    </div>
  )
}

/** A titled group of More settings rows in a lightly bordered card without dividers. */
export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <div className="mb-1.5 px-1 text-muted-foreground text-xs">{title}</div>
      <div className="rounded-xl border border-border-subtle px-3.5 py-1.5">{children}</div>
    </section>
  )
}

/** One More settings row: the name (and an optional hint) on the left, the control on the right. */
export function SettingsRow({
  label,
  hint,
  children,
  below
}: {
  label: string
  hint?: string
  children?: ReactNode
  /** Revealed content under the row, such as a slider. */
  below?: ReactNode
}) {
  return (
    <div className="py-1.5">
      <div className="flex min-h-8 items-center justify-between gap-4">
        <div className="min-w-0">
          <div className="text-foreground text-sm">{label}</div>
          {hint ? <div className="text-muted-foreground text-xs">{hint}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">{children}</div>
      </div>
      {below ? <div className="mt-2 mb-1">{below}</div> : null}
    </div>
  )
}

/** A row's drill-in link to its sub-page, showing a short summary such as `Enabled 2 / 5`. */
export function SettingsLinkButton({
  label,
  summary,
  onClick
}: {
  label: string
  summary?: string
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-label={summary ? `${label}: ${summary}` : label}
      onClick={onClick}
      className={cn(settingsPillClassName, 'max-w-60')}>
      {summary ? <span className="truncate">{summary}</span> : null}
      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
    </Button>
  )
}
