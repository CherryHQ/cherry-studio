import type { ResourceItem } from '@renderer/types/resourceCatalog'
import { isProtectedBuiltinAgentRole } from '@shared/ai/builtinAgent'

export function canDeleteResource(resource: ResourceItem): boolean {
  return resource.type !== 'agent' || !isProtectedBuiltinAgentRole(resource.raw.configuration?.builtin_role)
}
