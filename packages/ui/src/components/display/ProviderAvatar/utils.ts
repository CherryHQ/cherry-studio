// Utility functions for ProviderAvatar component

export function generateColorFromChar(char: string): string {
  const seed = char.charCodeAt(0)
  const a = 1664525
  const c = 1013904223
  const m = Math.pow(2, 32)

  let r = (a * seed + c) % m
  let g = (a * r + c) % m
  let b = (a * g + c) % m

  r = Math.floor((r / m) * 256)
  g = Math.floor((g / m) * 256)
  b = Math.floor((b / m) * 256)

  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function getFirstCharacter(str: string): string {
  for (const char of str) {
    return char
  }
  return ''
}

export function getForegroundColor(backgroundColor: string): string {
  // Simple luminance calculation
  const hex = backgroundColor.replace('#', '')
  const r = parseInt(hex.substring(0, 2), 16) / 255
  const g = parseInt(hex.substring(2, 4), 16) / 255
  const b = parseInt(hex.substring(4, 6), 16) / 255

  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b
  return luminance > 0.179 ? '#000000' : '#FFFFFF'
}
