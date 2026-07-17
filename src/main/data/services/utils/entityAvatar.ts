import type { EntityAvatar } from '@shared/data/types/entityAvatar'
import type { FileEntryId } from '@shared/data/types/file'

export interface ResolvedAvatarImage {
  fileId: FileEntryId
  src: string
}

export function resolveEntityAvatar(
  owner: { type: 'assistant' | 'agent'; id: string },
  emoji: string | null | undefined,
  image: ResolvedAvatarImage | undefined
): EntityAvatar {
  const hasEmoji = typeof emoji === 'string' && emoji.length > 0
  const hasImage = image !== undefined

  if (hasEmoji === hasImage) {
    throw new Error(
      `Invalid ${owner.type} avatar state for '${owner.id}': expected exactly one of avatarEmoji or image reference`
    )
  }

  return image ? { kind: 'image', fileId: image.fileId, src: image.src } : { kind: 'emoji', emoji: emoji! }
}
