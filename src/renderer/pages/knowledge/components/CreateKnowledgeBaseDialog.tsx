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
import { useModels } from '@renderer/hooks/useModel'
import type { KnowledgeSelectOption } from '@renderer/pages/knowledge/types'
import { DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY } from '@renderer/pages/knowledge/utils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { Group } from '@shared/data/types/group'
import type { CreateKnowledgeBaseDto, KnowledgeBase } from '@shared/data/types/knowledge'
import { isUniqueModelId, MODEL_CAPABILITY, parseUniqueModelId } from '@shared/data/types/model'
import type { FormEvent, ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { useEmbeddingDimensions } from '../hooks/useEmbeddingDimensions'
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

type CreateKnowledgeBaseInput = Pick<CreateKnowledgeBaseDto, 'name' | 'groupId' | 'embeddingModelId' | 'dimensions'>
type CreateKnowledgeBaseFormValues = Omit<CreateKnowledgeBaseInput, 'dimensions' | 'embeddingModelId'> & {
  embeddingModelId: string | null
}

const createInitialInput = (groupId?: string): CreateKnowledgeBaseFormValues => ({
  name: '',
  groupId,
  embeddingModelId: null
})

export const formatKnowledgeModelOptionLabel = (uniqueModelId: string) => {
  if (!isUniqueModelId(uniqueModelId)) {
    return uniqueModelId
  }

  const { providerId, modelId } = parseUniqueModelId(uniqueModelId)
  return `${modelId} · ${providerId}`
}

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
  const { models: embeddingModels } = useModels({
    capability: MODEL_CAPABILITY.EMBEDDING,
    enabled: true
  })
  const groupIds = useMemo(() => new Set(groups.map((group) => group.id)), [groups])
  const normalizedInitialGroupId = initialGroupId && groupIds.has(initialGroupId) ? initialGroupId : undefined
  const [values, setValues] = useState<CreateKnowledgeBaseFormValues>(() =>
    createInitialInput(normalizedInitialGroupId)
  )
  const [hasAttemptedSubmit, setHasAttemptedSubmit] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const { fetchDimensions, isFetchingDimensions } = useEmbeddingDimensions()

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

  const embeddingModelOptions: KnowledgeSelectOption[] = embeddingModels.map((model) => ({
    value: model.id,
    label: formatKnowledgeModelOptionLabel(model.id)
  }))
  const handleEmbeddingModelChange = (embeddingModelId: string) => {
    setValues((currentValues) => ({ ...currentValues, embeddingModelId }))
    setSubmitError(null)
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setHasAttemptedSubmit(true)
    setSubmitError(null)

    if (!values.name.trim() || !values.embeddingModelId) {
      return
    }

    let dimensions: number

    try {
      dimensions = await fetchDimensions(values.embeddingModelId)
    } catch (error) {
      setSubmitError(formatErrorMessageWithPrefix(error, t('message.error.get_embedding_dimensions')))
      return
    }

    const createInput: CreateKnowledgeBaseInput = {
      name: values.name,
      embeddingModelId: values.embeddingModelId,
      dimensions
    }

    if (values.groupId && groupIds.has(values.groupId)) {
      createInput.groupId = values.groupId
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
      <DialogContent size="lg">
        <CreateKnowledgeBaseDialog.Header title={t('knowledge.add.title')} />

        <CreateKnowledgeBaseDialog.Form onSubmit={handleSubmit}>
          <KnowledgeDialogBody>
            <KnowledgeDialogField>
              <Label htmlFor="knowledge-create-name">{t('common.name')}</Label>
              <Input
                id="knowledge-create-name"
                value={values.name}
                aria-invalid={hasAttemptedSubmit && !values.name.trim()}
                placeholder={t('common.name')}
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
                  value={values.groupId}
                  onValueChange={(groupId) =>
                    setValues((currentValues) => ({
                      ...currentValues,
                      groupId
                    }))
                  }>
                  <SelectTrigger size="sm" className="w-full">
                    <SelectValue placeholder={t(DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY)} />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </KnowledgeDialogField>
            ) : null}

            <KnowledgeDialogField>
              <Label>{t('knowledge.embedding_model')}</Label>
              <Select value={values.embeddingModelId ?? undefined} onValueChange={handleEmbeddingModelChange}>
                <SelectTrigger
                  size="sm"
                  className="w-full"
                  aria-invalid={hasAttemptedSubmit && !values.embeddingModelId}>
                  <SelectValue placeholder={t('knowledge.not_set')} />
                </SelectTrigger>
                <SelectContent>
                  {embeddingModelOptions.length > 0 ? (
                    embeddingModelOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))
                  ) : (
                    <div className="px-2.5 py-2 text-foreground-muted text-sm">{t('knowledge.not_set')}</div>
                  )}
                </SelectContent>
              </Select>
              {hasAttemptedSubmit && !values.embeddingModelId ? (
                <FieldError>{t('knowledge.embedding_model_required')}</FieldError>
              ) : null}
            </KnowledgeDialogField>

            {submitError ? <FieldError>{submitError}</FieldError> : null}
          </KnowledgeDialogBody>

          <CreateKnowledgeBaseDialog.Actions
            isCreating={isCreating || isFetchingDimensions}
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
