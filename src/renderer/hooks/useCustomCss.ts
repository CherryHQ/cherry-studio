import { usePreference } from '@data/hooks/usePreference'
import { useEffect } from 'react'

const CUSTOM_CSS_ELEMENT_ID = 'user-defined-custom-css'

/**
 * Sync a `<style id="user-defined-custom-css">` element in `<head>` with the given
 * active CSS text. Each renderer window is its own document, so every participating
 * window injects the same preference without an additional CSS scope.
 *
 * Empty/undefined `cssText` removes the element. The effect cleanup removes it on
 * unmount, so a window teardown never leaks the style node.
 */
export function useCustomCssInjection(cssText: string | undefined): void {
  useEffect(() => {
    // Defensive: drop any pre-existing node (stale leftover, or a prior run) before
    // (re)creating, so the element never duplicates.
    document.getElementById(CUSTOM_CSS_ELEMENT_ID)?.remove()

    if (!cssText) return

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
 * Inject the user's `ui.custom_css` preference verbatim in every regular UI window.
 * The preboot windows (`migrationV2`, `userDataRelocation`) are the exceptions —
 * they do not initialize preferences.
 */
export function useCustomCss(): void {
  const [customCss] = usePreference('ui.custom_css')
  useCustomCssInjection(customCss)
}
