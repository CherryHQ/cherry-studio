import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useKnowledgeItems } from '@renderer/data/hooks/useKnowledgeData'
import type { UrlItemData } from '@shared/data/types/knowledge'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { AddAction } from './types'

export const useAddUrlAction = (baseId: string, baseDisabled: boolean): AddAction => {
  const { t } = useTranslation()
  const { items } = useKnowledgeItems(baseId)

  const urlItems = useMemo(() => items.filter((item) => item.type === 'url'), [items])

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

    const urlInput = await PromptPopup.show({
      title: t('knowledge.add_url'),
      message: '',
      inputPlaceholder: t('knowledge.url_placeholder'),
      inputProps: {
        rows: 10,
        onPressEnter: () => {}
      }
    })

    if (!urlInput) {
      return
    }

    const urls = urlInput.split('\n').filter((url) => url.trim())

    for (const url of urls) {
      try {
        new URL(url.trim())
        const trimmedUrl = url.trim()
        const hasUrl = urlItems.some((item) => (item.data as UrlItemData).url === trimmedUrl)
        if (!hasUrl) {
          await createItemsApi({
            body: {
              items: [
                {
                  type: 'url',
                  data: { url: trimmedUrl, name: trimmedUrl } satisfies UrlItemData
                }
              ]
            }
          })
        } else {
          window.toast.success(t('knowledge.url_added'))
        }
      } catch {
        continue
      }
    }
  }, [baseDisabled, isCreatingItems, t, urlItems, createItemsApi])

  return {
    handler,
    disabled: baseDisabled,
    loading: isCreatingItems
  }
}
