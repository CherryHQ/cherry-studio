import { loggerService } from '@logger'
import PromptPopup from '@renderer/components/Popups/PromptPopup'
import { useMutation } from '@renderer/data/hooks/useDataApi'
import { useKnowledgeItems } from '@renderer/data/hooks/useKnowledgeData'
import type { SitemapItemData } from '@shared/data/types/knowledge'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import type { AddAction } from './types'

const logger = loggerService.withContext('useAddSitemapAction')

export const useAddSitemapAction = (baseId: string, baseDisabled: boolean): AddAction => {
  const { t } = useTranslation()
  const { items } = useKnowledgeItems(baseId)

  const sitemapItems = useMemo(() => items.filter((item) => item.type === 'sitemap'), [items])

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

    const url = await PromptPopup.show({
      title: t('knowledge.add_sitemap'),
      message: '',
      inputPlaceholder: t('knowledge.sitemap_placeholder'),
      inputProps: {
        maxLength: 1000,
        rows: 1
      }
    })

    if (!url) {
      return
    }

    try {
      new URL(url)
      const hasUrl = sitemapItems.some((item) => (item.data as SitemapItemData).url === url)
      if (hasUrl) {
        window.toast.success(t('knowledge.sitemap_added'))
        return
      }

      await createItemsApi({
        body: {
          items: [
            {
              type: 'sitemap',
              data: { url, name: url } satisfies SitemapItemData
            }
          ]
        }
      })
    } catch {
      logger.error(`Invalid Sitemap URL: ${url}`)
    }
  }, [baseDisabled, isCreatingItems, t, sitemapItems, createItemsApi])

  return {
    handler,
    disabled: baseDisabled,
    loading: isCreatingItems
  }
}
