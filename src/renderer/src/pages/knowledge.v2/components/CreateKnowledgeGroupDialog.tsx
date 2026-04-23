import {
  Button,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  FieldError,
  Input,
  Label
} from '@cherrystudio/ui'
import type { Group } from '@shared/data/types/group'
import type { FormEvent } from 'react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface CreateKnowledgeGroupDialogProps {
  open: boolean
  isCreating: boolean
  createGroup: (name: string) => Promise<Group>
  onOpenChange: (open: boolean) => void
}

const CreateKnowledgeGroupDialog = ({
  open,
  isCreating,
  createGroup,
  onOpenChange
}: CreateKnowledgeGroupDialogProps) => {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setName('')
      setHasAttemptedSubmit(false)
      setSubmitError(null)
    }
  }, [open])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const normalizedName = name.trim()

    setHasAttemptedSubmit(true)
    setSubmitError(null)

    if (!normalizedName) {
      return
    }

    try {
      await createGroup(normalizedName)
    } catch {
      setSubmitError(t('knowledge_v2.groups.error.failed_to_create'))
      return
    }

    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden rounded-2xl border-border/60 p-0">
        <DialogHeader className="gap-0.5 border-border/40 border-b px-4 py-3 text-left">
          <DialogTitle className="font-medium text-xs leading-4">{t('knowledge_v2.groups.add')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="space-y-1 px-4 py-3">
            <Label
              htmlFor="knowledge-v2-create-group-name"
              className="font-medium text-[11px] text-muted-foreground leading-4">
              {t('common.name')}
            </Label>
            <Input
              id="knowledge-v2-create-group-name"
              autoFocus
              value={name}
              aria-invalid={hasAttemptedSubmit && !name.trim()}
              placeholder={t('knowledge_v2.groups.name_placeholder')}
              className="h-8 rounded-lg px-2.5 text-[11px] leading-4 placeholder:text-[11px] placeholder:text-muted-foreground/70"
              onChange={(event) => setName(event.target.value)}
            />
            {hasAttemptedSubmit && !name.trim() ? (
              <FieldError className="text-[11px] leading-4">{t('knowledge_v2.groups.name_required')}</FieldError>
            ) : null}
            {submitError ? <FieldError className="text-[11px] leading-4">{submitError}</FieldError> : null}
          </div>

          <DialogFooter className="gap-2 border-border/40 border-t px-4 py-3 sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-8 rounded-lg px-3 font-medium text-[11px]"
              onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isCreating} className="h-8 rounded-lg px-3 font-medium text-[11px]">
              {t('common.add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default CreateKnowledgeGroupDialog
