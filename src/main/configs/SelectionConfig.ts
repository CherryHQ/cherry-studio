interface IBlacklist {
  WINDOWS: string[]
  MAC?: string[]
}

/**
 * 注意：请不要修改此配置，除非你非常清楚其含义、影响和行为的目的
 * Note: Do not modify this configuration unless you fully understand its meaning, implications, and intended behavior.
 * ----------------
 * Specification: must be all lowercase, need to accurately find the actual running program name
 */
export const SELECTION_PREDEFINED_BLACKLIST: IBlacklist = {
  WINDOWS: [
    'snipaste.exe',
    'pixpin.exe',
    'sharex.exe',
    'photoshop.exe',
    'adobe premiere pro.exe',
    'illustrator.exe',
    'afterfx.exe',
    'adobe audition.exe',
    'acad.exe'
  ]
}
