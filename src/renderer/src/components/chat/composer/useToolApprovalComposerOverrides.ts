import type { CherryMessagePart } from '@shared/data/types/message'
import { useMemo } from 'react'

import type { MessageToolApprovalInput } from '../messages/types'
import type { ComposerOverride } from './ComposerContext'
import {
  createAskUserQuestionComposerOverride,
  findLatestPendingAskUserQuestionRequest
} from './variants/AskUserQuestionComposer'
import { createPermissionRequestComposerOverride } from './variants/PermissionRequestComposer'
import { findLatestPendingPermissionRequest } from './variants/PermissionRequestComposerRequest'

type ToolApprovalComposerOverridesOptions = {
  partsByMessageId: Record<string, CherryMessagePart[]>
  onRespond: (input: MessageToolApprovalInput) => void | Promise<void>
}

export function useToolApprovalComposerOverrides({
  partsByMessageId,
  onRespond
}: ToolApprovalComposerOverridesOptions): readonly ComposerOverride[] {
  const askUserQuestionRequest = useMemo(
    () => findLatestPendingAskUserQuestionRequest(partsByMessageId),
    [partsByMessageId]
  )
  const permissionRequest = useMemo(() => findLatestPendingPermissionRequest(partsByMessageId), [partsByMessageId])

  return useMemo(() => {
    const overrides: ComposerOverride[] = []

    if (askUserQuestionRequest) {
      overrides.push(
        createAskUserQuestionComposerOverride({
          request: askUserQuestionRequest,
          onRespond
        })
      )
    }

    if (permissionRequest) {
      overrides.push(
        createPermissionRequestComposerOverride({
          request: permissionRequest,
          onRespond
        })
      )
    }

    return overrides
  }, [askUserQuestionRequest, onRespond, permissionRequest])
}
