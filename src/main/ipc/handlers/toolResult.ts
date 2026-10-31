import { fetchRemoteBytes } from '@main/utils/remoteFetch'
import type { toolResultRequestSchemas } from '@shared/ipc/schemas/toolResult'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const toolResultHandlers: IpcHandlersFor<typeof toolResultRequestSchemas> = {
  'tool_result.preview_image': async ({ url, imageHint }, { senderId }) => {
    if (senderId === null) return null
    const options = {
      allowPrivateNetwork: false,
      maxRedirects: 3,
      maxBytes: 8 * 1024 * 1024,
      signal: AbortSignal.timeout(5000)
    }
    try {
      const head = await fetchRemoteBytes(url, { ...options, method: 'HEAD' })
      const contentType = head.headers['content-type']?.split(';')[0].trim().toLowerCase()
      if (contentType ? !contentType.startsWith('image/') : !imageHint) return null
    } catch {
      if (!imageHint) return null
    }

    try {
      const image = await fetchRemoteBytes(url, options)
      const contentType = image.headers['content-type']?.split(';')[0].trim().toLowerCase()
      if (!contentType?.startsWith('image/')) return null
      return `data:${contentType};base64,${image.body.toString('base64')}`
    } catch {
      return null
    }
  }
}
