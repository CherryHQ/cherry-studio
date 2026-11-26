import { isLivePartInput, ThreadFeed, type ObservationPayload } from '@cherrystudio/agent-runtime'

export function observationReplay() {
  const feed = new ThreadFeed(
    { type: 'snapshot', messages: [], inputs: [], activity: { state: 'unknown' } },
    (error) => {
      throw error
    }
  )
  return (event: ObservationPayload) => {
    const accepted = isLivePartInput(event) ? feed.publishPart(event) : feed.publish(event)
    if (accepted?.type === 'snapshot') return accepted.messages
    if (accepted?.type === 'message.reconcile') return [accepted.message]
    if (
      accepted?.type === 'message.parts' ||
      accepted?.type === 'message.tool-output' ||
      accepted?.type === 'message.text-open' ||
      accepted?.type === 'message.text-append' ||
      accepted?.type === 'message.text-finish'
    ) {
      const message = feed.message(accepted.ref.id)
      return message ? [message] : []
    }
    return []
  }
}
