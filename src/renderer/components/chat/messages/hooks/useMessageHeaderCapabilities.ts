import { dataApiService } from '@data/DataApiService'
import { loggerService } from '@logger'
import type { MessageListActions, MessageListMeta } from '@renderer/components/chat/messages/types'
import { type ResourceEditDialogTarget, ResourceEditPopup } from '@renderer/components/resourceCatalog/dialogs/edit'
import UserPopup from '@renderer/components/UserPopup'
import useAvatar from '@renderer/hooks/useAvatar'
import { toast } from '@renderer/services/toast'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const logger = loggerService.withContext('useMessageHeaderCapabilities')

export function useMessageHeaderCapabilities(
  authorKind: ResourceEditDialogTarget['kind']
): Pick<MessageListMeta, 'userProfile'> & Pick<MessageListActions, 'openMessageAuthorEditor' | 'openUserProfile'> {
  const avatar = useAvatar()
  const { t } = useTranslation()

  const openUserProfile = useCallback<NonNullable<MessageListActions['openUserProfile']>>(() => {
    void UserPopup.show()
  }, [])

  const openMessageAuthorEditor = useCallback<NonNullable<MessageListActions['openMessageAuthorEditor']>>(
    async (authorId) => {
      try {
        if (authorKind === 'assistant') {
          const resource = await dataApiService.get(`/assistants/${authorId}`)
          await ResourceEditPopup.show({ kind: authorKind, resource })
          return
        }

        const resource = await dataApiService.get(`/agents/${authorId}`)
        await ResourceEditPopup.show({ kind: authorKind, resource })
      } catch (error) {
        logger.error(`Failed to load ${authorKind} for message author editor`, error as Error, { id: authorId })
        toast.error(t('common.error'))
      }
    },
    [authorKind, t]
  )

  return useMemo(
    () => ({
      userProfile: {
        avatar
      },
      openMessageAuthorEditor,
      openUserProfile
    }),
    [avatar, openMessageAuthorEditor, openUserProfile]
  )
}
