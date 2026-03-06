import RichEditPopup from '@renderer/components/Popups/RichEditPopup'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import type { NoteItemData } from '@shared/data/types/knowledge'
import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

import type { AddAction } from './types'

export const useAddNoteAction = (baseId: string, baseDisabled: boolean): AddAction => {
  const { t } = useTranslation()

  const { trigger: createItemsApi, isLoading: isCreatingItems } = useMutation(
    'POST',
    `/knowledge-bases/${baseId}/items`,
    {
      refresh: [`/knowledge-bases/${baseId}/items`]
    }
  )

  const handler = useCallback(async () => {
    if (baseDisabled || isCreatingItems) {
      return
    }

    const note = await RichEditPopup.show({
      content: '',
      modalProps: {
        title: t('knowledge.add_note')
      }
    })

    if (!note) {
      return
    }

    await createItemsApi({
      body: {
        items: [
          {
            type: 'note',
            data: { content: note } satisfies NoteItemData
          }
        ]
      }
    })
  }, [baseDisabled, isCreatingItems, t, createItemsApi])

  return {
    handler,
    disabled: baseDisabled,
    loading: isCreatingItems
  }
}
