import type { MessageListRuntime } from '@renderer/components/chat/messages/types'
import type { ImageActionRequest, ImageActionType } from '@renderer/utils/message/imageActionBus'

type MessageImageActionRequest = Pick<ImageActionRequest<unknown, string>, 'type'>

interface FlushPendingMessageImageActionsOptions<TRequest extends MessageImageActionRequest> {
  consumePendingActions: (targetId: string) => TRequest[]
  runtime: MessageListRuntime
  settleActionRequest: (request: TRequest, actionPromise: Promise<void> | void) => void
  targetId: string
}

interface BindCaptureMessageImageRuntimeOptions<TRequest extends MessageImageActionRequest>
  extends FlushPendingMessageImageActionsOptions<TRequest> {
  cancelMessage: string
  rejectPendingActions: (targetId: string, reason: unknown) => void
}

export function runMessageImageAction(runtime: MessageListRuntime, type: ImageActionType): Promise<void> | void {
  if (type === 'copy') {
    return runtime.copyTopicImage()
  }

  return runtime.exportTopicImage()
}

export function flushPendingMessageImageActions<TRequest extends MessageImageActionRequest>({
  consumePendingActions,
  runtime,
  settleActionRequest,
  targetId
}: FlushPendingMessageImageActionsOptions<TRequest>): void {
  const requests = consumePendingActions(targetId)
  for (const request of requests) {
    settleActionRequest(request, runMessageImageAction(runtime, request.type))
  }
}

export function bindCaptureMessageImageRuntime<TRequest extends MessageImageActionRequest>({
  cancelMessage,
  rejectPendingActions,
  ...flushOptions
}: BindCaptureMessageImageRuntimeOptions<TRequest>): () => void {
  flushPendingMessageImageActions(flushOptions)
  return () => rejectPendingActions(flushOptions.targetId, new Error(cancelMessage))
}
