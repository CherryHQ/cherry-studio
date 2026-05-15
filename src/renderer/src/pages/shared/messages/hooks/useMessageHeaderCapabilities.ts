import type { MessageListActions, MessageListMeta } from '@renderer/components/chat/messages/types'
import UserPopup from '@renderer/components/Popups/UserPopup'
import useAvatar from '@renderer/hooks/useAvatar'
import { useMiniAppPopup } from '@renderer/hooks/useMiniAppPopup'
import { useSidebarIconShow } from '@renderer/hooks/useSidebarIcon'
import { useCallback, useMemo } from 'react'

export function useMessageHeaderCapabilities(): Pick<MessageListMeta, 'userProfile'> &
  Pick<MessageListActions, 'openUserProfile' | 'openProviderApp'> {
  const avatar = useAvatar()
  const showMiniAppIcon = useSidebarIconShow('mini_app')
  const { openMiniAppById } = useMiniAppPopup()

  const openUserProfile = useCallback<NonNullable<MessageListActions['openUserProfile']>>(() => {
    UserPopup.show()
  }, [])

  const openProviderApp = useCallback<NonNullable<MessageListActions['openProviderApp']>>(
    (providerId) => {
      if (showMiniAppIcon) {
        openMiniAppById(providerId)
      }
    },
    [openMiniAppById, showMiniAppIcon]
  )

  return useMemo(
    () => ({
      userProfile: {
        avatar
      },
      openUserProfile,
      openProviderApp: showMiniAppIcon ? openProviderApp : undefined
    }),
    [avatar, openProviderApp, openUserProfile, showMiniAppIcon]
  )
}
