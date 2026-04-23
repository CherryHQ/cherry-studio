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
  onCreated?: (group: Group) => void
}

const CreateKnowledgeGroupDialog = ({
  open,
  isCreating,
  createGroup,
  onOpenChange,
  onCreated
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
      const createdGroup = await createGroup(normalizedName)
      onCreated?.(createdGroup)
      onOpenChange(false)
    } catch {
      setSubmitError(t('knowledge_v2.groups.error.failed_to_create'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md gap-0 overflow-hidden rounded-2xl border-border/60 p-0">
        <DialogHeader className="gap-1 border-border/40 border-b px-5 py-4 text-left">
          <DialogTitle className="font-semibold text-base">{t('knowledge_v2.groups.add')}</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex flex-col">
          <div className="space-y-1.5 px-5 py-4">
            <Label htmlFor="knowledge-v2-create-group-name">{t('common.name')}</Label>
            <Input
              id="knowledge-v2-create-group-name"
              autoFocus
              value={name}
              aria-invalid={hasAttemptedSubmit && !name.trim()}
              placeholder={t('knowledge_v2.groups.name_placeholder')}
              onChange={(event) => setName(event.target.value)}
            />
            {hasAttemptedSubmit && !name.trim() ? (
              <FieldError>{t('knowledge_v2.groups.name_required')}</FieldError>
            ) : null}
            {submitError ? <FieldError>{submitError}</FieldError> : null}
          </div>

          <DialogFooter className="border-border/40 border-t px-5 py-4 sm:justify-end">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={isCreating}>
              {t('common.add')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export default CreateKnowledgeGroupDialog
