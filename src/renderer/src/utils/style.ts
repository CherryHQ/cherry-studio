import { HexColor, isHexColor } from '@renderer/types'

type ClassValue = string | number | boolean | undefined | null | ClassDictionary | ClassArray

interface ClassDictionary {
  [id: string]: any
}

interface ClassArray extends Array<ClassValue> {}

/**
 * 生成 class 字符串
 *
 * Examples:
 * classNames('foo', 'bar'); // => 'foo bar'
 * classNames('foo', { bar: true }); // => 'foo bar'
 * classNames({ foo: true, bar: false }); // => 'foo'
 * classNames(['foo', 'bar']); // => 'foo bar'
 * classNames('foo', null, 'bar'); // => 'foo bar'
 * classNames({ message: true, 'message-assistant': true }); // => 'message message-assistant'
 * @param {ClassValue[]} args
 * @returns {string}
 */
export function classNames(...args: ClassValue[]): string {
  const classes: string[] = []

  args.forEach((arg) => {
    if (!arg) return

    if (typeof arg === 'string' || typeof arg === 'number') {
      classes.push(arg.toString())
    } else if (Array.isArray(arg)) {
      const inner = classNames(...arg)
      if (inner) {
        classes.push(inner)
      }
    } else if (typeof arg === 'object') {
      Object.entries(arg).forEach(([key, value]) => {
        if (value) {
          classes.push(key)
        }
      })
    }
  })

  return classes.filter(Boolean).join(' ')
}

function checkHexColor(value: string) {
  if (!isHexColor(value)) {
    throw new Error(`Invalid hex color string: ${value}`)
  }
}

function getRGB(hex: HexColor): [number, number, number] {
  checkHexColor(hex)
  // 移除开头的#号
  const cleanHex = hex.charAt(0) === '#' ? hex.slice(1) : hex

  // 将hex转换为RGB值
  const r = parseInt(cleanHex.slice(0, 2), 16)
  const g = parseInt(cleanHex.slice(2, 4), 16)
  const b = parseInt(cleanHex.slice(4, 6), 16)

  return [r, g, b]
}

/**
 * 计算相对亮度
 *
 * 相对亮度是一个介于0-1之间的值，用于表示颜色的亮度。
 * 这个计算基于 WCAG 2.0 规范，用于确定颜色的可访问性。
 *
 * 计算步骤:
 * 1. 将RGB值标准化到0-1范围
 * 2. 对每个颜色通道应用gamma校正
 * 3. 根据人眼对不同颜色的敏感度进行加权计算
 *
 * @param r - 红色通道值 (0-255)
 * @param g - 绿色通道值 (0-255)
 * @param b - 蓝色通道值 (0-255)
 * @returns 相对亮度值 (0-1)
 *
 * @see https://www.w3.org/TR/WCAG20/#relativeluminancedef
 */
function getRelativeLuminance(r: number, g: number, b: number): number {
  const rs = r / 255
  const gs = g / 255
  const bs = b / 255
  const normalize = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
  return 0.2126 * normalize(rs) + 0.7152 * normalize(gs) + 0.0722 * normalize(bs)
}

/**
 * 根据字符生成颜色代码，用于 avatar。
 * @param {string} char 输入字符
 * @returns {HexColor} 十六进制颜色字符串
 */
export function generateColorFromChar(char: string): HexColor {
  // 使用字符的Unicode值作为随机种子
  const seed = char.charCodeAt(0)

  // 使用简单的线性同余生成器创建伪随机数
  const a = 1664525
  const c = 1013904223
  const m = Math.pow(2, 32)

  // 生成三个伪随机数作为RGB值
  let r = (a * seed + c) % m
  let g = (a * r + c) % m
  let b = (a * g + c) % m

  // 将伪随机数转换为0-255范围内的整数
  r = Math.floor((r / m) * 256)
  g = Math.floor((g / m) * 256)
  b = Math.floor((b / m) * 256)

  // 返回十六进制颜色字符串
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

/**
 * 根据背景色获取合适的前景色（文字颜色）
 *
 * 该函数基于 WCAG 2.0 规范中的相对亮度计算方法，
 * 通过计算背景色的相对亮度来决定使用黑色还是白色作为前景色，
 * 以确保文字的可读性。
 *
 * @param {HexColor} backgroundColor - 背景色的十六进制颜色值（例如：'#FFFFFF'）
 * @returns {HexColor} 返回适合的前景色，要么是黑色('#000000')要么是白色('#FFFFFF')
 *
 * @see https://stackoverflow.com/questions/3942878/how-to-decide-font-color-in-white-or-black-depending-on-background-color
 *
 * @throws {Error} 当输入的颜色值格式不正确时抛出错误
 */
export function getForegroundColor(backgroundColor: HexColor): HexColor {
  checkHexColor(backgroundColor)

  const [r, g, b] = getRGB(backgroundColor)
  const luminance = getRelativeLuminance(r, g, b)

  return luminance > 0.179 ? '#000000' : '#FFFFFF'
}

// 用于ts方式控制响应式样式，暂时没用上
// 目前应该设计到lg就足够
// 应该和 file://./../assets/styles/responsive.scss 保持一致
/**
 * 断点配置对象，定义了不同屏幕尺寸的最小宽度（单位：像素）
 *
 * @property {number} xs - 超小屏幕断点，起始于 0px
 * @property {number} sm - 小屏幕断点，起始于 576px
 * @property {number} md - 中等屏幕断点，起始于 768px
 * @property {number} lg - 大屏幕断点，起始于 1080px
 * @property {number} xl - 超大屏幕断点，起始于 1200px
 * @property {number} xxl - 超超大屏幕断点，起始于 1400px
 */
// export const breakpoints = {
//   xs: 0,
//   sm: 576,
//   md: 768,
//   lg: 1080,
//   xl: 1200,
//   xxl: 1400
// } as const

// type MediaQueryFunction = (styles: string) => string
// type MediaQueries = Record<keyof typeof breakpoints, MediaQueryFunction>

/**
 * 媒体查询工具对象，用于生成响应式样式的媒体查询字符串
 *
 * @example
 * // 使用示例：
 * ```ts
 * const styles = {
 *   color: 'red',
 *   [media.md]: `
 *     color: blue;
 *   `,
 *   [media.lg]: `
 *     color: green;
 *   `
 * }
 * ```
 *
 * 生成的CSS将包含：
 * ```css
 *   color: red;
 *   @media (max-width: 768px) { color: blue; }
 *   @media (max-width: 992px) { color: green; }
 * ```
 */
// Not using for now
// export const media = objectKeys(breakpoints).reduce<MediaQueries>((acc, label) => {
//   const key = label
//   acc[key] = (styles: string): string => `
//     @media (max-width: ${breakpoints[key]}px) {
//       ${styles}
//     }
//   `
//   return acc
// }, {} as MediaQueries)
