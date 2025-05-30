interface IBlacklist {
  WINDOWS: string[]
  MAC?: string[]
}

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
