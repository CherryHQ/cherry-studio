export const USER_DEFINED_CUSTOM_CSS_ELEMENT_ID = 'user-defined-custom-css'
export const USER_DEFINED_FONT_PROTECTION_CSS_ELEMENT_ID = 'user-defined-font-protection-css'

const FONT_PROTECTION_CSS = `
/* 字体保护层：避免用户自定义 CSS 里的全局 font-family 误覆盖“显示设置”的字体选项 */
html,
body,
#root {
  font-family: var(--font-family) !important;
}

code,
pre,
kbd,
samp {
  font-family: var(--code-font-family) !important;
}
`.trim()

function removeStyleElementById(id: string) {
  document.getElementById(id)?.remove()
}

type ApplyUserCustomCssOptions = {
  sanitizeCss?: (css: string) => string
  enableFontProtection?: boolean
}

/**
 * 应用用户自定义 CSS。
 * 约束：会在注入用户 CSS 之后，追加一层“字体保护”样式，提升“设置-字体”的优先级。
 */
export function applyUserCustomCss(customCss: string | null | undefined, options?: ApplyUserCustomCssOptions) {
  if (typeof document === 'undefined') return

  removeStyleElementById(USER_DEFINED_CUSTOM_CSS_ELEMENT_ID)
  removeStyleElementById(USER_DEFINED_FONT_PROTECTION_CSS_ELEMENT_ID)

  const rawCss = customCss?.trim()
  if (!rawCss) return

  const sanitizedCss = (options?.sanitizeCss ? options.sanitizeCss(rawCss) : rawCss).trim()

  const userCssElement = document.createElement('style')
  userCssElement.id = USER_DEFINED_CUSTOM_CSS_ELEMENT_ID
  userCssElement.textContent = sanitizedCss
  document.head.appendChild(userCssElement)

  if (options?.enableFontProtection === false) return

  const fontProtectionElement = document.createElement('style')
  fontProtectionElement.id = USER_DEFINED_FONT_PROTECTION_CSS_ELEMENT_ID
  fontProtectionElement.textContent = FONT_PROTECTION_CSS
  document.head.appendChild(fontProtectionElement)
}
