export const V1_CUSTOM_CSS_MARKER = '/* cherry-studio:custom-css:v1 */'

/**
 * Preserve non-empty v1 CSS losslessly while marking it as unsafe to inject
 * into the redesigned v2 interface.
 */
export function markV1CustomCss(cssText: string): string {
  return cssText ? `${V1_CUSTOM_CSS_MARKER}\n${cssText}` : cssText
}

/** Return whether the exact v1 marker occupies the first line. */
export function hasV1CustomCssMarker(cssText: string | undefined): boolean {
  return (
    cssText === V1_CUSTOM_CSS_MARKER ||
    cssText?.startsWith(`${V1_CUSTOM_CSS_MARKER}\n`) === true ||
    cssText?.startsWith(`${V1_CUSTOM_CSS_MARKER}\r\n`) === true
  )
}
