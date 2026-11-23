/**
 * Hermetic child environment. Non-empty on purpose: an empty `env` makes Electron
 * inherit the whole parent environment. Definitions may only add variables.
 */

export interface EnvironmentInputs {
  /** Cherry-scoped temp dir the child sees as TMPDIR/TEMP/TMP. */
  tempDir: string
  parentEnv?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  nodeEnv?: string
}

const COMMON_KEYS = ['PATH', 'TZ', 'LANG', 'LANGUAGE']
const WIN32_KEYS = ['SYSTEMROOT', 'WINDIR', 'SYSTEMDRIVE', 'COMSPEC', 'PATHEXT']
const LINUX_KEYS = ['LD_LIBRARY_PATH', 'APPIMAGE', 'APPDIR', 'OWD']

/** Reserved for core, the runtime, or dynamic-library injection. */
const RESERVED_PREFIXES = ['NODE_', 'ELECTRON_', 'CHERRY_UTILITY_PROCESS_', 'LD_', 'DYLD_']

export function createUtilityProcessEnvironment(
  inputs: EnvironmentInputs,
  additions?: Readonly<Record<string, string>>
) {
  const parentEnv = inputs.parentEnv ?? process.env
  const platform = inputs.platform ?? process.platform

  const parentEntries = Object.entries(parentEnv).filter(
    (entry): entry is [string, string] => typeof entry[1] === 'string'
  )

  const env = new Map<string, string>()

  const wanted = [
    ...COMMON_KEYS,
    ...(platform === 'win32' ? WIN32_KEYS : []),
    ...(platform === 'linux' ? LINUX_KEYS : [])
  ]

  for (const name of wanted) {
    // Windows env keys are case-insensitive (`Path`); keep the parent's spelling.
    const match = parentEntries.find(([key]) => key.toUpperCase() === name)

    if (match) env.set(match[0], match[1])
  }

  for (const [key, value] of parentEntries) {
    if (key.toUpperCase().startsWith('LC_')) env.set(key, value)
  }

  env.set('NODE_ENV', inputs.nodeEnv ?? parentEnv.NODE_ENV ?? 'production')
  env.set('TMPDIR', inputs.tempDir)
  env.set('TEMP', inputs.tempDir)
  env.set('TMP', inputs.tempDir)

  if (additions === undefined) return Object.fromEntries(env)
  const baseline = new Set([...env.keys()].map((key) => key.toUpperCase()))

  for (const [key, value] of Object.entries(additions)) {
    const upper = key.toUpperCase()

    if (typeof value !== 'string') {
      throw new TypeError(`utility process env '${key}' must be a string`)
    }

    if (baseline.has(upper)) {
      throw new TypeError(`utility process env '${key}' would override the hermetic baseline`)
    }

    if (RESERVED_PREFIXES.some((prefix) => upper.startsWith(prefix))) {
      throw new TypeError(
        `utility process env '${key}' is reserved (NODE_*, ELECTRON_*, CHERRY_UTILITY_PROCESS_*, LD_*, DYLD_*)`
      )
    }

    env.set(key, value)
  }

  return Object.fromEntries(env)
}
