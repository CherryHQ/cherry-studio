export type HexColor = string

/**
 * Checks whether a string is a valid hex color value.
 * @param value the string to check
 */
export const isHexColor = (value: string): value is HexColor => {
  return /^#([0-9A-F]{3}){1,2}$/i.test(value)
}
