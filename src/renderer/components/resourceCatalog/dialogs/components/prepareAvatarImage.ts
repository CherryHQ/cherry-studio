import { toast } from '@renderer/services/toast'
import { checkEntityImageSize, prepareEntityImageBytes } from '@renderer/utils/image'

export async function prepareAvatarImage(
  file: File,
  isActive: () => boolean
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const error = checkEntityImageSize(file)
  if (error) {
    toast.error(error)
    return
  }
  const data = await prepareEntityImageBytes(file)
  return isActive() ? data : undefined
}
