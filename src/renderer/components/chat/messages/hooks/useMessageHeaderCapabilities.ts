import { useCallback, useMemo } from 'react'

import type { MessageListActions, MessageListMeta } from '@renderer/components/chat/messages/types'
import useAvatar from '@renderer/hooks/useAvatar'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'

export function useMessageHeaderCapabilities(): Pick<MessageListMeta, 'userProfile'> &
  Pick<MessageListActions, 'openUserProfile'> {
  const avatar = useAvatar()

  const openUserProfile = useCallback<NonNullable<MessageListActions['openUserProfile']>>(() => {
    openSettingsTab('/settings/profile')
  }, [])

  return useMemo(
    () => ({
      userProfile: {
        avatar
      },
      openUserProfile
    }),
    [avatar, openUserProfile]
  )
}
