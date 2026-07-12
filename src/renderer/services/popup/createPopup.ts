import { popupService } from './PopupService'
import type { CreatePopupOptions, PopupComponent, PopupHandle } from './types'

/**
 * Turn a popup component into an imperative handle. The component receives its own
 * props plus the injected `{ open, resolve }` (PopupInjectedProps); the call site
 * awaits `handle.show(props)`.
 *
 * Single-flight: a second `show()` while one is in flight returns the first promise
 * and ignores the new props. This is deliberate — it replaces the retired full-screen
 * view stack's same-id dedup, which silently dropped the second call and left its
 * promise hanging.
 *
 * Pass the type params explicitly — `createPopup<OwnProps, Result>(Component, opts)` —
 * so `show(props)` takes only the component's own props. Inference cannot subtract
 * the injected `{ open, resolve }` from the component's prop type on its own.
 */
export function createPopup<P extends object, R>(
  Component: PopupComponent<P, R>,
  opts?: CreatePopupOptions<R>
): PopupHandle<P, R> {
  const dismissResult = opts?.dismissResult as R
  let inFlight: Promise<R> | null = null
  let currentInstanceId: string | null = null

  const show = (props?: P): Promise<R> => {
    if (inFlight) return inFlight

    const instanceId = popupService.generateInstanceId()
    currentInstanceId = instanceId
    const promise = popupService.showComponent(Component, (props ?? {}) as P, instanceId, dismissResult)
    inFlight = promise

    const clear = () => {
      if (currentInstanceId === instanceId) {
        inFlight = null
        currentInstanceId = null
      }
    }
    promise.then(clear, clear)

    return promise
  }

  const hide = (): void => {
    if (currentInstanceId) {
      popupService.settle(currentInstanceId, dismissResult)
    }
  }

  return { show, hide } as PopupHandle<P, R>
}
