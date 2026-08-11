export interface SessionCreateResult {
  ok: true
  sessionId: string
  delivery?: {
    status?: string
  }
}

export interface SessionSendResult {
  ok: true
  status?: string
  delivery?: {
    receiver?: { agentId?: string; sessionId?: string }
    receiverSnapshot?: { agentName?: string; sessionName?: string }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseJsonResult(value: unknown): unknown {
  if (isRecord(value) && Array.isArray(value.content)) {
    const text = value.content
      .map((item) => (isRecord(item) && typeof item.text === 'string' ? item.text : ''))
      .filter(Boolean)
      .join('\n')
    try {
      return JSON.parse(text)
    } catch {
      return undefined
    }
  }
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

export function parseSessionCreateResult(value: unknown): SessionCreateResult | undefined {
  const candidate = parseJsonResult(value)
  if (!isRecord(candidate) || candidate.ok !== true || typeof candidate.sessionId !== 'string') return undefined
  const delivery = isRecord(candidate.delivery) ? candidate.delivery : undefined
  return {
    ok: true,
    sessionId: candidate.sessionId,
    delivery: delivery && typeof delivery.status === 'string' ? { status: delivery.status } : undefined
  }
}

export function parseSessionSendResult(value: unknown): SessionSendResult | undefined {
  const candidate = parseJsonResult(value)
  if (!isRecord(candidate) || candidate.ok !== true) return undefined

  const delivery = isRecord(candidate.delivery) ? candidate.delivery : undefined
  const receiver = delivery && isRecord(delivery.receiver) ? delivery.receiver : undefined
  const receiverSnapshot = delivery && isRecord(delivery.receiverSnapshot) ? delivery.receiverSnapshot : undefined

  return {
    ok: true,
    status: typeof candidate.status === 'string' ? candidate.status : undefined,
    delivery: delivery
      ? {
          receiver: receiver
            ? {
                agentId: typeof receiver.agentId === 'string' ? receiver.agentId : undefined,
                sessionId: typeof receiver.sessionId === 'string' ? receiver.sessionId : undefined
              }
            : undefined,
          receiverSnapshot: receiverSnapshot
            ? {
                agentName: typeof receiverSnapshot.agentName === 'string' ? receiverSnapshot.agentName : undefined,
                sessionName: typeof receiverSnapshot.sessionName === 'string' ? receiverSnapshot.sessionName : undefined
              }
            : undefined
        }
      : undefined
  }
}
