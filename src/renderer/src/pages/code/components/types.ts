import type { IconComponent } from '@cherrystudio/ui/icons'
import type { codeCLI } from '@shared/config/constant'

export interface CodeToolMeta {
  id: codeCLI
  label: string
  icon: IconComponent | null | undefined
}
