import { useDispatch, useSelector } from 'react-redux'

import type { RootState } from '../store'
import {
  type CopilotState,
  resetCopilotState,
  setAvatar,
  setDefaultHeaders,
  setUsername,
  updateCopilotState
} from '../store/copilot'

/**
 * 用于访问和操作Copilot相关状态的钩子函数
 * @returns Copilot状态和操作方法
 */
export function useCopilot() {
  const dispatch = useDispatch()
  const copilotState = useSelector((state: RootState) => state.copilot)

  const updateUsername = (username: string) => {
    dispatch(setUsername(username))
  }

  const updateAvatar = (avatar: string) => {
    dispatch(setAvatar(avatar))
  }

  const updateDefaultHeaders = (headers: Record<string, string>) => {
    dispatch(setDefaultHeaders(headers))
  }

  const updateState = (state: Partial<CopilotState>) => {
    dispatch(updateCopilotState(state))
  }

  const resetState = () => {
    dispatch(resetCopilotState())
  }

  return {
    // 当前状态
    ...copilotState,

    // 状态更新方法
    updateUsername,
    updateAvatar,
    updateDefaultHeaders,
    updateState,
    resetState
  }
}
