import { usePreference } from '@data/hooks/usePreference'
import { hasV1CustomCssMarker } from '@shared/data/preference/customCss'
import { useEffect } from 'react'

const CUSTOM_CSS_ELEMENT_ID = 'user-defined-custom-css'

/**
 * Sync a `<style id="user-defined-custom-css">` element in `<head>` with the given
 * active CSS text. Each renderer window is its own document, so every participating
 * window injects the same preference without an additional CSS scope.
 *
 * Empty/undefined or v1-marked `cssText` removes the element. The marker is
 * migration metadata rather than a CSS safeguard, so marked payloads are never
 * handed to the browser. The effect cleanup removes the element on unmount, so a
 * window teardown never leaks the style node.
 */
export function useCustomCssInjection(cssText: string | undefined): void {
  useEffect(() => {
    // Defensive: drop any pre-existing node (stale leftover, or a prior run) before
    // (re)creating, so the element never duplicates.
    document.getElementById(CUSTOM_CSS_ELEMENT_ID)?.remove()

    if (!cssText || hasV1CustomCssMarker(cssText)) return

    const element = document.createElement('style')
    element.id = CUSTOM_CSS_ELEMENT_ID
    element.textContent = cssText
    document.head.appendChild(element)

    return () => {
      element.remove()
    }
  }, [cssText])
}

/**
 * Inject the user's active `ui.custom_css` preference in every regular UI window.
 * `migrationV2` is the preboot exception and does not initialize preferences.
 * V1-marked content is rejected by the shared injection primitive.
 */
export function useCustomCss(): void {
  const [customCss] = usePreference('ui.custom_css')
  useCustomCssInjection(customCss)
}
