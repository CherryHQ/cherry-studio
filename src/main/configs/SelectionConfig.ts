interface IBlacklist {
  WINDOWS: string[]
  MAC?: string[]
}

/*************************************************************************
 * 注意：请不要修改此配置，除非你非常清楚其含义、影响和行为的目的
 * Note: Do not modify this configuration unless you fully understand its meaning, implications, and intended behavior.
 * -----------------------------------------------------------------------
 * A predefined application filter list to include commonly used software
 * that does not require text selection but may conflict with it, and disable them in advance.
 * Only available in the selected mode.
 *
 * Specification: must be all lowercase, need to accurately find the actual running program name
 *************************************************************************/
export const SELECTION_PREDEFINED_BLACKLIST: IBlacklist = {
  WINDOWS: [
    // Screenshot
    'snipaste.exe',
    'pixpin.exe',
    'sharex.exe',
    // Office
    'excel.exe',
    'powerpnt.exe',
    // Image Editor
    'photoshop.exe',
    'illustrator.exe',
    // Video Editor
    'adobe premiere pro.exe',
    'afterfx.exe',
    // Audio Editor
    'adobe audition.exe',
    // 3D Editor
    'blender.exe',
    '3dsmax.exe',
    'maya.exe',
    // CAD
    'acad.exe',
    'sldworks.exe'
  ]
}
