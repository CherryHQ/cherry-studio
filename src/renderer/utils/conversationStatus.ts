export function getConversationStatus({
  isAwaitingApproval,
  isPending,
  isErrored,
  isFulfilled,
  isActive
}: {
  isAwaitingApproval: boolean
  isPending: boolean
  isErrored: boolean
  isFulfilled: boolean
  isActive: boolean
}) {
  if (isAwaitingApproval) return 'approval'
  if (isPending) return 'pending'
  if (isErrored) return 'error'
  if (!isActive && isFulfilled) return 'done'
  return null
}
