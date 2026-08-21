import type { AvatarValue } from '@shared/data/types/avatar'
import type { FileEntryId } from '@shared/data/types/file'

export interface ResolvedAvatarImage {
  fileId: FileEntryId
  src: string
}

export function resolveAvatarValue(
  owner: { type: 'assistant' | 'agent'; id: string },
  emoji: string | null | undefined,
  image: ResolvedAvatarImage | undefined
): AvatarValue {
  const hasEmoji = typeof emoji === 'string' && emoji.length > 0
  const hasImage = image !== undefined

  if (hasEmoji === hasImage) {
    throw new Error(
      `Invalid ${owner.type} avatar state for '${owner.id}': expected exactly one of avatarEmoji or image reference`
    )
  }

  return image ? { kind: 'image', fileId: image.fileId, src: image.src } : { kind: 'emoji', emoji: emoji! }
}
