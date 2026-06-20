import type { IconComponent } from '@cherrystudio/ui/icons'
import type { codeCLI } from '@shared/types/codeCli'

export interface CodeToolMeta {
  id: codeCLI
  label: string
  icon: IconComponent | null | undefined
}
