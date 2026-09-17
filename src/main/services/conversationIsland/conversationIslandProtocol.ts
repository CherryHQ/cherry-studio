export const CONVERSATION_ISLAND_PROTOCOL_VERSION = 1 as const
export const CONVERSATION_ISLAND_MAX_LINE_BYTES = 1024 * 1024

export type ConversationIslandStateKind = 'pending' | 'streaming' | 'awaiting-confirmation' | 'done' | 'error'

export interface ConversationIslandActivityItem {
  activityId: string
  identityAvatar: string
  identityName: string
  state: ConversationIslandStateKind
  statusText: string
  title: string
}

export interface ConversationIslandPresentationPayload {
  displayId: number
  expanded: boolean
  reducedMotion: boolean
  theme: {
    appearance: 'light' | 'dark'
    primaryColor: string
    fontFamily: string
  }
  primaryActivityId: string
  activityCount: number
  activityCountText: string
  activities: ConversationIslandActivityItem[]
}

export type ConversationIslandCommand =
  | {
      version: 1
      type: 'present'
      revision: number
      payload: ConversationIslandPresentationPayload
    }
  | { version: 1; type: 'dismiss'; revision: number }
  | { version: 1; type: 'shutdown' }

export type ConversationIslandHelperEvent =
  | { version: 1; type: 'ready'; pid: number }
  | { version: 1; type: 'setExpanded'; revision: number; expanded: boolean }
  | { version: 1; type: 'openActivity'; revision: number; activityId: string }
  | { version: 1; type: 'hidden'; revision: number }

export type JsonLineFrame = { kind: 'line'; line: string } | { kind: 'error'; reason: 'invalid-utf8' | 'line-too-long' }

type JsonObject = Record<string, unknown>

const ACTIVITY_STATES = new Set<ConversationIslandStateKind>([
  'pending',
  'streaming',
  'awaiting-confirmation',
  'done',
  'error'
])

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: JsonObject, keys: readonly string[]): boolean {
  const actualKeys = Object.keys(value)
  return actualKeys.length === keys.length && actualKeys.every((key) => keys.includes(key))
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function isActivity(value: unknown): value is ConversationIslandActivityItem {
  if (!isJsonObject(value)) return false
  if (
    !hasExactKeys(value, ['activityId', 'identityAvatar', 'identityName', 'state', 'statusText', 'title']) ||
    !isNonemptyString(value.activityId) ||
    typeof value.identityAvatar !== 'string' ||
    typeof value.identityName !== 'string' ||
    typeof value.state !== 'string' ||
    !ACTIVITY_STATES.has(value.state as ConversationIslandStateKind) ||
    typeof value.statusText !== 'string' ||
    typeof value.title !== 'string'
  ) {
    return false
  }

  return true
}

function isPresentationPayload(value: unknown): value is ConversationIslandPresentationPayload {
  if (!isJsonObject(value)) return false
  if (
    !hasExactKeys(value, [
      'displayId',
      'expanded',
      'reducedMotion',
      'theme',
      'primaryActivityId',
      'activityCount',
      'activityCountText',
      'activities'
    ]) ||
    typeof value.displayId !== 'number' ||
    !Number.isInteger(value.displayId) ||
    typeof value.expanded !== 'boolean' ||
    typeof value.reducedMotion !== 'boolean' ||
    !isJsonObject(value.theme) ||
    !hasExactKeys(value.theme, ['appearance', 'primaryColor', 'fontFamily']) ||
    (value.theme.appearance !== 'light' && value.theme.appearance !== 'dark') ||
    typeof value.theme.primaryColor !== 'string' ||
    typeof value.theme.fontFamily !== 'string' ||
    !isNonemptyString(value.primaryActivityId) ||
    !isNonnegativeSafeInteger(value.activityCount) ||
    value.activityCount === 0 ||
    typeof value.activityCountText !== 'string' ||
    !Array.isArray(value.activities) ||
    value.activities.length === 0 ||
    !value.activities.every(isActivity)
  ) {
    return false
  }

  const activityIds = new Set(value.activities.map((activity) => activity.activityId))
  return (
    activityIds.size === value.activities.length &&
    activityIds.has(value.primaryActivityId) &&
    value.activityCount >= value.activities.length
  )
}

function isConversationIslandCommand(value: unknown): value is ConversationIslandCommand {
  if (!isJsonObject(value) || value.version !== CONVERSATION_ISLAND_PROTOCOL_VERSION) return false

  switch (value.type) {
    case 'present':
      return (
        hasExactKeys(value, ['version', 'type', 'revision', 'payload']) &&
        isNonnegativeSafeInteger(value.revision) &&
        isPresentationPayload(value.payload)
      )
    case 'dismiss':
      return hasExactKeys(value, ['version', 'type', 'revision']) && isNonnegativeSafeInteger(value.revision)
    case 'shutdown':
      return hasExactKeys(value, ['version', 'type'])
    default:
      return false
  }
}

function isConversationIslandHelperEvent(value: unknown): value is ConversationIslandHelperEvent {
  if (!isJsonObject(value) || value.version !== CONVERSATION_ISLAND_PROTOCOL_VERSION) return false

  switch (value.type) {
    case 'ready':
      return (
        hasExactKeys(value, ['version', 'type', 'pid']) &&
        typeof value.pid === 'number' &&
        Number.isSafeInteger(value.pid) &&
        value.pid > 0
      )
    case 'setExpanded':
      return (
        hasExactKeys(value, ['version', 'type', 'revision', 'expanded']) &&
        isNonnegativeSafeInteger(value.revision) &&
        typeof value.expanded === 'boolean'
      )
    case 'openActivity':
      return (
        hasExactKeys(value, ['version', 'type', 'revision', 'activityId']) &&
        isNonnegativeSafeInteger(value.revision) &&
        isNonemptyString(value.activityId)
      )
    case 'hidden':
      return hasExactKeys(value, ['version', 'type', 'revision']) && isNonnegativeSafeInteger(value.revision)
    default:
      return false
  }
}

function decodeUtf8(bytes: Buffer): JsonLineFrame {
  try {
    return { kind: 'line', line: new TextDecoder('utf-8', { fatal: true }).decode(bytes) }
  } catch {
    return { kind: 'error', reason: 'invalid-utf8' }
  }
}

export class JsonLineDecoder {
  private bufferedChunks: Buffer[] = []
  private bufferedBytes = 0
  private discardingOversizedLine = false

  push(chunk: Buffer): JsonLineFrame[] {
    const frames: JsonLineFrame[] = []
    let offset = 0

    while (offset < chunk.length) {
      if (this.discardingOversizedLine) {
        const lineFeedOffset = chunk.indexOf(0x0a, offset)
        if (lineFeedOffset === -1) return frames

        this.discardingOversizedLine = false
        offset = lineFeedOffset + 1
        continue
      }

      const lineFeedOffset = chunk.indexOf(0x0a, offset)
      const segmentEnd = lineFeedOffset === -1 ? chunk.length : lineFeedOffset
      const segment = chunk.subarray(offset, segmentEnd)

      if (this.bufferedBytes + segment.length > CONVERSATION_ISLAND_MAX_LINE_BYTES) {
        frames.push({ kind: 'error', reason: 'line-too-long' })
        this.clearBufferedLine()

        if (lineFeedOffset === -1) {
          this.discardingOversizedLine = true
          return frames
        }

        offset = lineFeedOffset + 1
        continue
      }

      if (segment.length > 0) {
        this.bufferedChunks.push(Buffer.from(segment))
        this.bufferedBytes += segment.length
      }

      if (lineFeedOffset === -1) return frames

      const lineBytes =
        this.bufferedChunks.length === 1
          ? this.bufferedChunks[0]
          : Buffer.concat(this.bufferedChunks, this.bufferedBytes)
      frames.push(decodeUtf8(lineBytes))
      this.clearBufferedLine()
      offset = lineFeedOffset + 1
    }

    return frames
  }

  end(): { frames: JsonLineFrame[]; hadIncompleteLine: boolean } {
    const hadIncompleteLine = this.discardingOversizedLine || this.bufferedBytes > 0
    this.clearBufferedLine()
    this.discardingOversizedLine = false
    return { frames: [], hadIncompleteLine }
  }

  private clearBufferedLine(): void {
    this.bufferedChunks = []
    this.bufferedBytes = 0
  }
}

export function encodeConversationIslandCommand(command: ConversationIslandCommand): Buffer {
  if (!isConversationIslandCommand(command)) {
    throw new Error('Invalid conversation island command')
  }

  return Buffer.from(`${JSON.stringify(command)}\n`)
}

export function decodeConversationIslandHelperEvent(line: string): ConversationIslandHelperEvent {
  let value: unknown

  try {
    value = JSON.parse(line)
  } catch {
    throw new Error('Invalid conversation island helper event')
  }

  if (!isConversationIslandHelperEvent(value)) {
    throw new Error('Invalid conversation island helper event')
  }

  return value
}
