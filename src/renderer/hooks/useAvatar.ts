import { useCache } from '@data/hooks/useCache'
import { UserAvatar } from '@renderer/config/env'

export default function useAvatar() {
  const [avatar] = useCache('app.user.avatar', UserAvatar)
  return avatar
}
