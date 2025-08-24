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

/**
 * 根据字符生成颜色代码，用于 avatar。
 * @param {string} char 输入字符
 * @returns {string} 十六进制颜色字符串
 */
export function generateColorFromChar(char: string): string {
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
