import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from 'react-i18next'

import {
  FieldError,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { DEFAULT_KNOWLEDGE_GROUP_LABEL_KEY } from '@renderer/pages/knowledge/utils/group'
import type { Group } from '@shared/data/types/group'
import type { CreateKnowledgeBaseDto } from '@shared/data/types/knowledge'

import { KnowledgeDialogField } from './KnowledgeDialogLayout'
import { KnowledgeEmbeddingModelSelect } from './KnowledgeEmbeddingModelSelect'

export type KnowledgeBaseFormValues = Pick<CreateKnowledgeBaseDto, 'name' | 'groupId'> & {
  embeddingModelId: string | null
}

const DEFAULT_GROUP_OPTION_VALUE = '__default__'

export const KnowledgeBaseCreationFields = ({
  values,
  setValues,
  groups,
  hasAttemptedSubmit = false,
  disabled = false,
  onSettingsNavigate
}: {
  values: KnowledgeBaseFormValues
  setValues: Dispatch<SetStateAction<KnowledgeBaseFormValues>>
  groups: Group[]
  disabled?: boolean
  hasAttemptedSubmit?: boolean
  onSettingsNavigate: (action: () => void) => void
}) => {
  const { t } = useTranslation()
  return (
    <>
      <KnowledgeDialogField>
        <Label htmlFor="knowledge-create-name">{t('common.name')}</Label>
        <Input
          disabled={disabled}
          id="knowledge-create-name"
          value={values.name}
          aria-invalid={hasAttemptedSubmit && !values.name.trim()}
          placeholder={t('common.name')}
          onChange={(event) => setValues((currentValues) => ({ ...currentValues, name: event.target.value }))}
        />
        {hasAttemptedSubmit && !values.name.trim() ? <FieldError>{t('knowledge.name_required')}</FieldError> : null}
      </KnowledgeDialogField>

      <KnowledgeDialogField>
        <Label>{t('knowledge.embedding_model')}</Label>
        <KnowledgeEmbeddingModelSelect
          aria-label={t('knowledge.embedding_model')}
          value={values.embeddingModelId}
          placeholder={t('knowledge.rag.rerank_disabled')}
          noneOptionLabel={t('knowledge.rag.rerank_disabled')}
          onSettingsNavigate={onSettingsNavigate}
          onChange={(embeddingModelId) => setValues((current) => ({ ...current, embeddingModelId }))}
        />
      </KnowledgeDialogField>

      {groups.length > 0 ? (
        <KnowledgeDialogField>
          <Label>{t('knowledge.add.group')}</Label>
          <Select
            disabled={disabled}
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
    </>
  )
}
