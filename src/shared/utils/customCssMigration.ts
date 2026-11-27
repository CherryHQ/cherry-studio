export const V1_CUSTOM_CSS_MARKER = '/* cherry-studio:custom-css:v1 */'

/** Return whether the exact v1 marker occupies the first line. */
export function hasV1CustomCssMarker(cssText: string | undefined): boolean {
  return (
    cssText === V1_CUSTOM_CSS_MARKER ||
    cssText?.startsWith(`${V1_CUSTOM_CSS_MARKER}\n`) === true ||
    cssText?.startsWith(`${V1_CUSTOM_CSS_MARKER}\r\n`) === true
  )
}
