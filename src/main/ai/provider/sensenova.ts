import { UnsupportedFunctionalityError } from '@ai-sdk/provider'

export function isSenseNovaApiURL(url: string): boolean {
  try {
    return new URL(url).hostname === 'token.sensenova.cn'
  } catch {
    return false
  }
}

export function createSenseNovaImageFetch(fetch: typeof globalThis.fetch): typeof globalThis.fetch {
  return async (input, init) => {
    const url = input instanceof Request ? input.url : String(input)
    if (
      !isSenseNovaApiURL(url) ||
      !new URL(url).pathname.endsWith('/images/edits') ||
      !(init?.body instanceof FormData)
    ) {
      return fetch(input, init)
    }

    const form = init.body
    if (form.has('mask')) throw new UnsupportedFunctionalityError({ functionality: 'SenseNova image edit masks' })
    if (form.has('n') && form.get('n') !== '1') {
      throw new UnsupportedFunctionalityError({ functionality: 'SenseNova image edits with n other than 1' })
    }
    const files = [...form.getAll('image'), ...form.getAll('image[]')]
    if (files.length > 5)
      throw new UnsupportedFunctionalityError({ functionality: 'SenseNova edits with more than 5 images' })

    const body: Record<string, unknown> = { response_format: 'b64_json' }
    for (const [key, value] of form.entries()) {
      if (key === 'image' || key === 'image[]') continue
      if (key === 'n') body[key] = Number(value)
      else if (key === 'watermark' || key === 'prompt_extend') {
        body[key] = value === 'true' ? true : value === 'false' ? false : value
      } else body[key] = value
    }
    body.images = await Promise.all(
      files.map(async (file) => ({
        image_url:
          file instanceof Blob
            ? `data:${file.type};base64,${Buffer.from(await file.arrayBuffer()).toString('base64')}`
            : file
      }))
    )
    const headers = new Headers(init.headers)
    headers.set('Content-Type', 'application/json')
    return fetch(input, { ...init, headers, body: JSON.stringify(body) })
  }
}
