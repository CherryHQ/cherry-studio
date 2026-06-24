import type { MessageListActions, MessageListMeta } from '@renderer/components/chat/messages/types'
import UserPopup from '@renderer/components/Popups/UserPopup'
import useAvatar from '@renderer/hooks/useAvatar'
import { useCallback, useMemo } from 'react'

export function useMessageHeaderCapabilities(): Pick<MessageListMeta, 'userProfile'> &
  Pick<MessageListActions, 'openUserProfile'> {
  const avatar = useAvatar()

  const openUserProfile = useCallback<NonNullable<MessageListActions['openUserProfile']>>(() => {
    void UserPopup.show()
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
