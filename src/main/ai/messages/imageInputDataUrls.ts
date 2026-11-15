import { application } from '@application'

export interface ReadImageInputOptions {
  /** Caps the number of read entries; an undefined limit reads every id. */
  limit?: number
  signal?: AbortSignal
}

/** Read managed image entries as base64 data URLs — the shared input format of image editing. */
export async function readImageInputDataUrls(
  ids: readonly string[],
  { limit, signal }: ReadImageInputOptions = {}
): Promise<string[]> {
  const selected = limit === undefined ? ids : ids.slice(0, limit)
  return Promise.all(
    selected.map(async (id) => {
      signal?.throwIfAborted()
      const { content, mime } = await application.get('FileManager').read(id, { encoding: 'base64' })
      signal?.throwIfAborted()
      if (!mime.startsWith('image/')) throw new Error(`FileEntry ${id} is not an image.`)
      return `data:${mime};base64,${content}`
    })
  )
}
