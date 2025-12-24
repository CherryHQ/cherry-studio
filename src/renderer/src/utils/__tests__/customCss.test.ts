import { describe, expect, it } from 'vitest'

import {
  applyUserCustomCss,
  USER_DEFINED_CUSTOM_CSS_ELEMENT_ID,
  USER_DEFINED_FONT_PROTECTION_CSS_ELEMENT_ID
} from '../customCss'

describe('applyUserCustomCss', () => {
  it('customCss 为空时会移除已注入的样式', () => {
    document.head.innerHTML = `
      <style id="${USER_DEFINED_CUSTOM_CSS_ELEMENT_ID}">body{color:red}</style>
      <style id="${USER_DEFINED_FONT_PROTECTION_CSS_ELEMENT_ID}">body{font-family:serif}</style>
    `

    applyUserCustomCss('')

    expect(document.getElementById(USER_DEFINED_CUSTOM_CSS_ELEMENT_ID)).toBeNull()
    expect(document.getElementById(USER_DEFINED_FONT_PROTECTION_CSS_ELEMENT_ID)).toBeNull()
  })

  it('会先注入用户 CSS，再注入字体保护层', () => {
    document.head.innerHTML = ''

    applyUserCustomCss('body { font-family: serif; }')

    const userCss = document.getElementById(USER_DEFINED_CUSTOM_CSS_ELEMENT_ID)
    const protectionCss = document.getElementById(USER_DEFINED_FONT_PROTECTION_CSS_ELEMENT_ID)

    expect(userCss).not.toBeNull()
    expect(protectionCss).not.toBeNull()
    expect(userCss?.nextSibling).toBe(protectionCss)
  })

  it('支持 sanitizeCss', () => {
    document.head.innerHTML = ''

    applyUserCustomCss('body{background:red;} body{color:blue;}', {
      sanitizeCss: (css) => css.replace(/background\s*:[^;]+;/g, '')
    })

    const userCss = document.getElementById(USER_DEFINED_CUSTOM_CSS_ELEMENT_ID) as HTMLStyleElement
    expect(userCss.textContent).toContain('color:blue')
    expect(userCss.textContent).not.toContain('background')
  })
})
