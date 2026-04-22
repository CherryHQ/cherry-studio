import { useMutation } from '@data/hooks/useDataApi'
import type { KnowledgeBase } from '@shared/data/types/knowledge'

import type { KnowledgeV2RagConfigFormValues } from '../types'
import { buildKnowledgeV2RagConfigPatch, createKnowledgeV2RagConfigFormValues } from '../utils/ragConfig'

export const useKnowledgeV2SaveRagConfig = (base: KnowledgeBase) => {
  const { trigger, isLoading, error } = useMutation('PATCH', '/knowledge-bases/:id', {
    refresh: ['/knowledge-bases']
  })

  const save = (values: KnowledgeV2RagConfigFormValues) => {
    const initialValues = createKnowledgeV2RagConfigFormValues(base)

    return trigger({
      params: { id: base.id },
      body: buildKnowledgeV2RagConfigPatch(initialValues, values)
    })
  }

  return {
    save,
    isLoading,
    error
  }
}
