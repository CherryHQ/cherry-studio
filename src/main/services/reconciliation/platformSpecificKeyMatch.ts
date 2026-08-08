// Match preference keys against PREFERENCES `platformSpecificKeys` globs (§6.1).
// finalize validates glob *syntax* only (no minimatch dep); restore needs the same
// character set (* ? [abc]) for exclusion. Keep this matcher aligned with
// `isLegalGlob` in contributors/finalize.ts.

const REGEX_META = new Set(['\\', '^', '$', '.', '|', '(', ')', '+', '{', '}', '/'])

/**
 * True when `key` matches a finalize-legal platformSpecificKeys glob.
 * `*` → any run of chars; `?` → one char; `[…]` → character class (passed through).
 */
export function matchPlatformSpecificGlob(pattern: string, key: string): boolean {
  let re = '^'
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]
    if (c === '*') {
      re += '.*'
    } else if (c === '?') {
      re += '.'
    } else if (c === '[') {
      const end = pattern.indexOf(']', i + 1)
      if (end === -1) return false
      re += pattern.slice(i, end + 1)
      i = end
    } else if (REGEX_META.has(c)) {
      re += `\\${c}`
    } else {
      re += c
    }
  }
  re += '$'
  return new RegExp(re).test(key)
}

/** True when `key` matches any of the declared platformSpecificKeys patterns. */
export function isPlatformSpecificPreferenceKey(key: string, patterns: readonly string[]): boolean {
  return patterns.some((p) => matchPlatformSpecificGlob(p, key))
}
