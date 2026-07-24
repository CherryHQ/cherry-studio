import { usePreference } from '@data/hooks/usePreference'
import { hasV1CustomCssMarker } from '@shared/utils/customCssMigration'
import { useEffect } from 'react'

const CUSTOM_CSS_ELEMENT_ID = 'user-defined-custom-css'

/**
 * Sync a `<style id="user-defined-custom-css">` element in `<head>` with the given
 * CSS text. The DOM-injection primitive for every UI window; the preference read lives
 * in the caller (`useCustomCss` for the standard windows, a background-stripped variant
 * for the selection toolbar), so this hook stays value-driven and free of any
 * window-specific policy.
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
 * Inject the user's active `ui.custom_css` preference. The standard custom-CSS owner
 * for the windows that render the full app chrome (main / subWindow / quickAssistant /
 * selection-action). V1-marked content is rejected by the shared injection primitive.
 * The selection toolbar does not use this: it strips background declarations first, so
 * it calls `useCustomCssInjection` directly with the filtered CSS.
 */
export function useCustomCss(): void {
  const [customCss] = usePreference('ui.custom_css')
  useCustomCssInjection(customCss)
}
