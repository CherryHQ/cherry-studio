import { describe, expect, it } from 'vitest'

import { parseTheme, resolveColor } from '../worker/themeResolver'

const SAMPLE_THEME_XML = `<?xml version="1.0"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Office Theme">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:dk2><a:srgbClr val="1F497D"/></a:dk2>
      <a:lt2><a:srgbClr val="EEECE1"/></a:lt2>
      <a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
      <a:accent2><a:srgbClr val="C0504D"/></a:accent2>
      <a:accent3><a:srgbClr val="9BBB59"/></a:accent3>
      <a:accent4><a:srgbClr val="8064A2"/></a:accent4>
      <a:accent5><a:srgbClr val="4BACC6"/></a:accent5>
      <a:accent6><a:srgbClr val="F79646"/></a:accent6>
      <a:hlink><a:srgbClr val="0000FF"/></a:hlink>
      <a:folHlink><a:srgbClr val="800080"/></a:folHlink>
    </a:clrScheme>
  </a:themeElements>
</a:theme>`

describe('parseTheme', () => {
  it('null input falls back to Office default theme colors', () => {
    const theme = parseTheme(null)
    // 契约索引顺序:[lt1, dk1, lt2, dk2, accent1..6, hlink, folHlink]
    expect(theme.colors[0]).toBe('#ffffff') // lt1
    expect(theme.colors[1]).toBe('#000000') // dk1
    expect(theme.colors).toHaveLength(12)
  })

  it('parses real theme XML and applies the dk1/lt1 index swap from contract §6', () => {
    const theme = parseTheme(SAMPLE_THEME_XML)
    expect(theme.colors[0]).toBe('#ffffff') // index 0 = lt1 (XML: window/FFFFFF)
    expect(theme.colors[1]).toBe('#000000') // index 1 = dk1 (XML: windowText/000000)
    expect(theme.colors[4]).toBe('#4f81bd') // accent1
  })

  it('malformed XML falls back to default theme rather than throwing', () => {
    const theme = parseTheme('<not-xml-at-all')
    expect(theme.colors).toHaveLength(12)
  })
})

describe('resolveColor', () => {
  const theme = parseTheme(SAMPLE_THEME_XML)

  it('argb takes priority: opaque argb -> 6-digit css hex', () => {
    expect(resolveColor({ argb: 'FFFF0000' }, theme)).toBe('#ff0000')
  })

  it('argb alpha byte is ignored (Excel cell formats have no transparency)', () => {
    // openpyxl 把 6 位色值规范化成 '00RRGGBB',按字面渲染会得到全透明文字
    expect(resolveColor({ argb: '00FFFFFF' }, theme)).toBe('#ffffff')
    expect(resolveColor({ argb: '80FF0000' }, theme)).toBe('#ff0000')
  })

  it('theme index without tint returns the scheme color as-is', () => {
    expect(resolveColor({ theme: 1 }, theme)).toBe('#000000')
  })

  it('theme + tint applies HSL tint algorithm (dark tint)', () => {
    // accent1 = 4F81BD, tint -0.25 -> 376092 (cross-checked against a Python colorsys reference)
    expect(resolveColor({ theme: 4, tint: -0.25 }, theme)).toBe('#376092')
  })

  it('theme + tint applies HSL tint algorithm (light tint)', () => {
    // accent1 = 4F81BD, tint +0.40 -> 95B3D7
    expect(resolveColor({ theme: 4, tint: 0.4 }, theme)).toBe('#95b3d7')
  })

  it('indexed color resolves via the built-in 64-color palette', () => {
    expect(resolveColor({ indexed: 2 }, theme)).toBe('#ff0000') // red
    expect(resolveColor({ indexed: 5 }, theme)).toBe('#ffff00') // yellow
    expect(resolveColor({ indexed: 12 }, theme)).toBe('#0000ff') // blue
  })

  it('undefined color ref returns undefined', () => {
    expect(resolveColor(undefined, theme)).toBeUndefined()
  })

  it('priority: argb > theme+tint > indexed', () => {
    expect(resolveColor({ argb: 'FF00FF00', theme: 1, indexed: 2 }, theme)).toBe('#00ff00')
  })
})
