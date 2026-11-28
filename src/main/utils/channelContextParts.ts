import type { CherryMessagePart } from '@shared/data/types/message'
import { ChannelContextPartDataSchema } from '@shared/data/types/uiParts'

/**
 * Hidden channel metadata is host-owned: only parts the main process persisted carry authority, so
 * renderer-supplied parts never keep a data-channel-context part, however well-formed. Strip them
 * on every renderer ingress (IPC dispatch and message PATCH); the stored message's own part is
 * restored by restoreStoredChannelContext.
 */
export function stripChannelContextParts(parts: CherryMessagePart[]): CherryMessagePart[] {
  return parts.filter((part) => part.type !== 'data-channel-context')
}

/**
 * Renderer writes (edit-and-resend, message PATCH) rebuild a user message's parts, so the hidden
 * source-chat identity of a channel-originated turn would silently drop off. Re-attach the LAST
 * schema-valid context part from the stored message - or nothing when the stored message carries
 * none. Renderer round-trips are stripped first and cannot substitute for the stored part.
 */
export function restoreStoredChannelContext(
  userParts: CherryMessagePart[],
  storedParts: CherryMessagePart[]
): CherryMessagePart[] {
  const stored = storedParts
    .filter((part) => part.type === 'data-channel-context' && ChannelContextPartDataSchema.safeParse(part.data).success)
    .at(-1)
  return stored ? [...userParts, stored] : userParts
}
