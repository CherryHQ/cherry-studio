import type { IconComponent } from '@cherrystudio/ui/icons'
import type { codeCLI } from '@shared/types/codeCli'

export interface CodeToolMeta {
  id: codeCLI
  label: string
  icon: IconComponent | null | undefined
}

/** Install/upgrade status for a single CLI tool binary. */
export interface VersionStatus {
  installed: boolean
  current?: string
  latest?: string
  canUpgrade: boolean
}
