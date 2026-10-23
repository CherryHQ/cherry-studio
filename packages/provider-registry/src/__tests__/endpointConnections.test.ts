import { describe, expect, it } from 'vitest'

import { PROVIDERS } from '../providers'
import { canInheritEndpointConnection, endpointImpliedCapability } from '../registry-utils'
import type { EndpointType } from '../schemas/enums'

describe('provider connection defaults', () => {
  it('does not freeze inherited task URLs by copying the same connection root into a preset', () => {
    const duplicates: string[] = []
    for (const provider of PROVIDERS) {
      const configs = provider.endpointConfigs ?? {}
      for (const endpointType of Object.keys(configs) as EndpointType[]) {
        const target = configs[endpointType]
        if (!endpointImpliedCapability(endpointType) || !target?.baseUrl) continue
        for (const sourceType of Object.keys(configs) as EndpointType[]) {
          const source = configs[sourceType]
          if (endpointImpliedCapability(sourceType) || !source?.baseUrl) continue
          if (
            canInheritEndpointConnection(endpointType, sourceType, target, source) &&
            target.baseUrl === source.baseUrl
          ) {
            duplicates.push(`${provider.id}:${endpointType}`)
          }
        }
      }
    }
    expect(duplicates).toEqual([])
  })
})
