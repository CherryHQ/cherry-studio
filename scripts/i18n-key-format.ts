export function checkTranslationKeyFormat(keys: readonly string[]): void {
  const invalid = keys.filter((key) => !/^[^\s.]+(?:\.[^\s.]+)+$/.test(key))
  if (invalid.length) {
    throw new Error(
      `Translation keys must use nonempty dot-separated segments (e.g. agent.import.missing_file): ${invalid.join(', ')}`
    )
  }
}
