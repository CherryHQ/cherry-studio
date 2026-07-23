import {
  Button,
  Dialog,
  DialogContent,
  FieldError,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import { DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY } from '@renderer/pages/knowledge/utils/group'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import { LOCAL_EMBEDDING_DIMENSIONS, LOCAL_EMBEDDING_UNIQUE_MODEL_ID } from '@shared/data/presets/localEmbedding'
import type { Group } from '@shared/data/types/group'
import type { CreateKnowledgeBaseDto, KnowledgeBase } from '@shared/data/types/knowledge'
import type { FormEvent, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  KnowledgeDialogBody,
  KnowledgeDialogField,
  KnowledgeDialogFooter,
  KnowledgeDialogHeader
} from './KnowledgeDialogLayout'

interface CreateKnowledgeBaseDialogProps {
  open: boolean
  groups: Group[]
  initialGroupId?: string
  isCreating: boolean
  createBase: (input: CreateKnowledgeBaseInput) => Promise<KnowledgeBase>
  onOpenChange: (open: boolean) => void
  onCreated: (base: KnowledgeBase) => void
}

// The form only collects name + group. A base is created BM25-only unless the
// optional local embedding model is already downloaded, in which case submit
// backfills embeddingModelId + dimensions so the base starts as a vector base.
type CreateKnowledgeBaseInput = Pick<CreateKnowledgeBaseDto, 'name' | 'groupId' | 'embeddingModelId' | 'dimensions'>
type CreateKnowledgeBaseFormValues = Pick<CreateKnowledgeBaseDto, 'name' | 'groupId'>

// Radix Select forbids an empty option value, so represent the default (ungrouped) group with a sentinel.
const DEFAULT_GROUP_OPTION_VALUE = '__default__'

const createInitialInput = (groupId?: string): CreateKnowledgeBaseFormValues => ({
  name: '',
  groupId
})

const CreateKnowledgeBaseDialogHeader = ({ title }: { title: string }) => {
  return <KnowledgeDialogHeader>{title}</KnowledgeDialogHeader>
}

const CreateKnowledgeBaseDialogForm = ({
  children,
  onSubmit
}: {
  children: ReactNode
  onSubmit: (event: FormEvent<HTMLFormElement>) => void
}) => {
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {children}
    </form>
  )
}

const CreateKnowledgeBaseDialogActions = ({
  isCreating,
  onCancel,
  submitLabel,
  cancelLabel
}: {
  isCreating: boolean
  onCancel: () => void
  submitLabel: string
  cancelLabel: string
}) => {
  return (
    <KnowledgeDialogFooter>
      <Button type="button" variant="outline" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button type="submit" variant="emphasis" loading={isCreating}>
        {submitLabel}
      </Button>
    </KnowledgeDialogFooter>
  )
}

const CreateKnowledgeBaseDialogRoot = ({
  open,
  groups,
  initialGroupId,
  isCreating,
  createBase,
  onOpenChange,
  onCreated
}: CreateKnowledgeBaseDialogProps) => {
  const { t } = useTranslation()
  const groupIds = useMemo(() => new Set(groups.map((group) => group.id)), [groups])
  const normalizedInitialGroupId = initialGroupId && groupIds.has(initialGroupId) ? initialGroupId : undefined
  const [values, setValues] = useState<CreateKnowledgeBaseFormValues>(() =>
    createInitialInput(normalizedInitialGroupId)
  )
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) {
      setValues(createInitialInput(normalizedInitialGroupId))
      setHasAttemptedSubmit(false)
      setSubmitError(null)
    }
  }, [open, normalizedInitialGroupId])

  useEffect(() => {
    setValues((currentValues) => {
      if (!currentValues.groupId || groupIds.has(currentValues.groupId)) {
        return currentValues
      }

      return { ...currentValues, groupId: undefined }
    })
  }, [groupIds])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    setSubmitError(null)

    if (!values.name.trim()) {
      return
    }

    const createInput: CreateKnowledgeBaseInput = {
      name: values.name
    }

    if (values.groupId && groupIds.has(values.groupId)) {
      createInput.groupId = values.groupId
    }

    // "Build a vector base when the local model is ready": if the optional local
    // embedding model is already downloaded, default the new base to it (paired
    // with its fixed dimensions) so users don't have to enable it afterwards. A
    // 'ready' status guarantees the user_model row exists, so this can't trip the
    // embeddingModelId foreign key. The probe is best-effort — on failure fall back
    // to BM25-only creation rather than blocking.
    try {
      const { status } = await ipcApi.request('local_model.get_status', { model: 'embedding' })
      if (status === 'ready') {
        createInput.embeddingModelId = LOCAL_EMBEDDING_UNIQUE_MODEL_ID
        createInput.dimensions = LOCAL_EMBEDDING_DIMENSIONS
      }
    } catch {
      // best-effort probe; fall back to BM25-only creation
    }

    let createdBase: KnowledgeBase

    try {
      createdBase = await createBase(createInput)
    } catch (error) {
      setSubmitError(formatErrorMessageWithPrefix(error, t('knowledge.error.failed_to_create')))
      return
    }

    onCreated(createdBase)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeOnOverlayClick={false} size="sm">
        <CreateKnowledgeBaseDialog.Header title={t('knowledge.add.title')} />

        <CreateKnowledgeBaseDialog.Form onSubmit={handleSubmit}>
          <KnowledgeDialogBody>
            <KnowledgeDialogField>
              <Label htmlFor="knowledge-create-name">{t('common.name')}</Label>
              <Input
                id="knowledge-create-name"
                value={values.name}
                aria-invalid={hasAttemptedSubmit && !values.name.trim()}
                onChange={(event) => setValues((currentValues) => ({ ...currentValues, name: event.target.value }))}
              />
              {hasAttemptedSubmit && !values.name.trim() ? (
                <FieldError>{t('knowledge.name_required')}</FieldError>
              ) : null}
            </KnowledgeDialogField>

            {groups.length > 0 ? (
              <KnowledgeDialogField>
                <Label>{t('knowledge.add.group')}</Label>
                <Select
                  value={values.groupId ?? DEFAULT_GROUP_OPTION_VALUE}
                  onValueChange={(groupId) =>
                    setValues((currentValues) => ({
                      ...currentValues,
                      groupId: groupId === DEFAULT_GROUP_OPTION_VALUE ? undefined : groupId
                    }))
                  }>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder={t(DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY)} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={DEFAULT_GROUP_OPTION_VALUE}>{t(DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY)}</SelectItem>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </KnowledgeDialogField>
            ) : null}

            {submitError ? <FieldError>{submitError}</FieldError> : null}
          </KnowledgeDialogBody>

          <CreateKnowledgeBaseDialog.Actions
            isCreating={isCreating}
            onCancel={() => onOpenChange(false)}
            cancelLabel={t('common.cancel')}
            submitLabel={t('knowledge.add.submit')}
          />
        </CreateKnowledgeBaseDialog.Form>
      </DialogContent>
    </Dialog>
  )
}

export const CreateKnowledgeBaseDialog = Object.assign(CreateKnowledgeBaseDialogRoot, {
  Header: CreateKnowledgeBaseDialogHeader,
  Form: CreateKnowledgeBaseDialogForm,
  Actions: CreateKnowledgeBaseDialogActions
})

export default CreateKnowledgeBaseDialog
