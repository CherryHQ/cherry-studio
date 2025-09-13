export function getLastChars(str: string, k: number = 100): string {
  if (str.length <= k) {
    return str
  }

  return str.slice(-k)
}
