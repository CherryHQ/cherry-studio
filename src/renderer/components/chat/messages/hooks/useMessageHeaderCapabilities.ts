import type { MessageListActions, MessageListMeta } from '@renderer/components/chat/messages/types'
import { type ResourceEditDialogTarget, ResourceEditPopup } from '@renderer/components/resourceCatalog/dialogs/edit'
import UserPopup from '@renderer/components/UserPopup'
import useAvatar from '@renderer/hooks/useAvatar'
import { useCallback, useMemo } from 'react'

export function useMessageHeaderCapabilities(
  authorKind: ResourceEditDialogTarget['kind']
): Pick<MessageListMeta, 'userProfile'> & Pick<MessageListActions, 'openMessageAuthorEditor' | 'openUserProfile'> {
  const avatar = useAvatar()

  const openUserProfile = useCallback<NonNullable<MessageListActions['openUserProfile']>>(() => {
    void UserPopup.show()
  }, [])

  const openMessageAuthorEditor = useCallback<NonNullable<MessageListActions['openMessageAuthorEditor']>>(
    (authorId) => ResourceEditPopup.show({ target: { kind: authorKind, id: authorId } }),
    [authorKind]
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
