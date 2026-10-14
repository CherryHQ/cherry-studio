/** Keep the live edge exact whenever the viewport is in following mode. */

import { useCallback, useMemo } from 'react'

export interface AutoStickInputs {
  isFollowing(): boolean
  stickToBottom(): void
}

export interface AutoStickToBottom {
  /** Caller invokes on every observed content or viewport size change. */
  onContentSizeChange(): void
}

export function useAutoStickToBottom({ isFollowing, stickToBottom }: AutoStickInputs): AutoStickToBottom {
  const onContentSizeChange = useCallback(() => {
    if (isFollowing()) stickToBottom()
  }, [isFollowing, stickToBottom])

  return useMemo(() => ({ onContentSizeChange }), [onContentSizeChange])
}
