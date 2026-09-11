import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, Textarea } from '@cherrystudio/ui'
import { type FormEvent, useEffect, useId, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface QuoteTokenEditDialogProps {
  content: string
  label: string
  maxLength: number
  open: boolean
  onCancel: () => void
  onSave: (content: string) => void
}

export default function QuoteTokenEditDialog({
  content,
  label,
  maxLength,
  open,
  onCancel,
  onSave
}: QuoteTokenEditDialogProps) {
  const { t } = useTranslation()
  const inputId = useId()
  const [value, setValue] = useState(content)
  const canSave = value.trim().length > 0 && value.length <= maxLength

  useEffect(() => {
    if (open) setValue(content)
  }, [content, open])

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!canSave) return
    onSave(value)
  }

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onCancel()}>
      <DialogContent aria-describedby={undefined} closeOnOverlayClick={false} size="lg">
        <form className="flex min-h-0 flex-col gap-4" onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>
              {t('common.edit')} {label}
            </DialogTitle>
          </DialogHeader>
          <label className="sr-only" htmlFor={inputId}>
            {label}
          </label>
          <Textarea.Input
            id={inputId}
            autoFocus
            rows={10}
            maxLength={maxLength}
            value={value}
            className="max-h-[60vh] min-h-48 w-full resize-y"
            onChange={(event) => setValue(event.target.value)}
          />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onCancel}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" variant="emphasis" disabled={!canSave}>
              {t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
