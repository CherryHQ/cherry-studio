/** Browser `node:crypto` subset used by the data services. */
class RandomBytes extends Uint8Array {
  override toString(encoding?: string): string {
    if (encoding !== 'hex') throw new Error(`randomBytes(): unsupported encoding "${encoding}" in the browser`)
    return Array.from(this, (byte) => byte.toString(16).padStart(2, '0')).join('')
  }
}

export function randomBytes(size: number): RandomBytes {
  return crypto.getRandomValues(new RandomBytes(size))
}

export function randomUUID(): string {
  return crypto.randomUUID()
}
