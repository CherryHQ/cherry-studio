import { createOvmsConfig } from './config'

export function createOvmsFields(models?: Array<{ label: string; value: string }>) {
  return createOvmsConfig(models).filter((item) => item.key !== 'model') as any[]
}
