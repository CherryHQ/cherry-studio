import { net } from 'electron'

import { themePageSchema, type themeRequestSchemas } from '@shared/ipc/schemas/theme'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const themeHandlers: IpcHandlersFor<typeof themeRequestSchemas> = {
  'theme.marketplace.submit': async ({ key, light_pic, dark_pic, ...content }) => {
    const form = new FormData()
    form.append(
      'content',
      JSON.stringify({ ...content, description: '', light_mode: !!light_pic, dark_mode: !!dark_pic })
    )
    for (const [field, file] of Object.entries({ light_pic, dark_pic })) {
      if (file) form.append(field, new Blob([Uint8Array.from(file.bytes)], { type: file.type }), file.name)
    }
    const response = await net.fetch('https://cherryai.com.cn/api/website/theme-submissions', {
      method: 'POST',
      credentials: 'omit',
      redirect: 'error',
      headers: { 'Idempotency-Key': key },
      body: form,
      signal: AbortSignal.timeout(30000)
    })
    if (!response.ok) throw new Error(`Theme submission HTTP ${response.status}`)
  },
  'theme.marketplace.list': async (input) => {
    const url = new URL('https://cherryai.com.cn/api/website/themes')
    for (const [key, value] of Object.entries(input)) {
      if (value !== '') url.searchParams.set(key, String(value))
    }
    const response = await net.fetch(url.href, { signal: AbortSignal.timeout(15000), credentials: 'omit' })
    if (!response.ok) throw new Error(`Theme catalog HTTP ${response.status}`)
    return themePageSchema.parse(await response.json())
  }
}
