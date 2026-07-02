import { useCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import UserAvatar from '@renderer/assets/images/avatar.png'
import { resolveStoredImageSrc } from '@renderer/utils/storedImage'

export default function useAvatar() {
  const [avatar] = usePreference('app.user.avatar')
  const [filesPath] = useCache('app.path.files')
  // A stored file-entry id resolves to a file:// URL; emoji / default pass through.
  return resolveStoredImageSrc(avatar, filesPath) || UserAvatar
}
