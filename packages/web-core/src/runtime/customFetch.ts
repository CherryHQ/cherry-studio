// Browser `ai/utils/customFetch`. The Worker's own `fetch` already follows redirects and sends
// the provider's `User-Agent` where the browser allows it, so Electron's workarounds do not apply.

/** Same contract as the desktop slot: the innermost fetch records the body actually sent. */
export const HTTP_TRACE_FINAL_BODY_SLOT: unique symbol = Symbol('httpTrace.finalBody')

export interface HttpTraceFinalBodySlot {
  body?: BodyInit | null
}

export const customFetch: typeof fetch = (input, init) => {
  const finalBodySlot = (init as { [HTTP_TRACE_FINAL_BODY_SLOT]?: HttpTraceFinalBodySlot } | undefined)?.[
    HTTP_TRACE_FINAL_BODY_SLOT
  ]
  if (finalBodySlot) finalBodySlot.body = init?.body ?? null
  return fetch(input, init)
}

export function installProviderUserAgentInterceptor(): () => void {
  throw new Error('The provider User-Agent interceptor is Electron-only')
}
