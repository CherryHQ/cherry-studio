import { usePreference } from '@data/hooks/usePreference'
import { UserAvatar } from '@renderer/config/env'

export default function useAvatar() {
  const [avatar] = usePreference('app.user.avatar')
  return avatar || UserAvatar
}
