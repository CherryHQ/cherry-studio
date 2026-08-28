import type { IconComponent } from '@cherrystudio/ui/icons'
import type { BinaryApplication, BinaryOperation } from '@shared/types/binary'
import type { CodeCli } from '@shared/types/codeCli'

export interface CodeToolMeta {
  id: CodeCli
  label: string
  icon: IconComponent | null | undefined
}

/** Install/upgrade status for a single CLI tool binary. */
export interface VersionStatus {
  installed: boolean
  source: 'mise' | 'bundled' | 'system' | 'none'
  /** Exact-backend-application status; drives update/uninstall/repair authority. */
  applicationStatus?: BinaryApplication['status']
  systemPath?: string
  current?: string
  latest?: string
  canUpgrade: boolean
  operation?: BinaryOperation
}
