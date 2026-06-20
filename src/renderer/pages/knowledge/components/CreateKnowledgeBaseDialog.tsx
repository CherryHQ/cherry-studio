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
import { DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY } from '@renderer/pages/knowledge/utils'
import { formatErrorMessageWithPrefix } from '@renderer/utils/error'
import type { Group } from '@shared/data/types/group'
import type { CreateKnowledgeBaseDto, KnowledgeBase } from '@shared/data/types/knowledge'
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
import { isEmbeddingModel, KnowledgeModelSelect } from './KnowledgeModelSelect'

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

// Radix Select forbids an empty option value, so represent the default (ungrouped) group with a sentinel.
const DEFAULT_GROUP_OPTION_VALUE = '__default__'

const createInitialInput = (groupId?: string): CreateKnowledgeBaseFormValues => ({
  name: '',
  groupId,
  embeddingModelId: null
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

  const handleEmbeddingModelChange = (embeddingModelId: string | null) => {
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

            <KnowledgeDialogField>
              <Label>{t('knowledge.embedding_model')}</Label>
              <KnowledgeModelSelect
                aria-label={t('knowledge.embedding_model')}
                value={values.embeddingModelId}
                placeholder={t('knowledge.not_set')}
                filter={isEmbeddingModel}
                invalid={hasAttemptedSubmit && !values.embeddingModelId}
                onChange={handleEmbeddingModelChange}
              />
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
