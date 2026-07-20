import { describe, expect, it } from 'vitest'

import { assertUniqueUiNodeIds, uiContractForDescriptor } from '../semanticId'
import { transformJsx } from '../transform'

const options = { sourceFile: 'src/renderer/components/chat/Message.tsx' }

describe('UI node identity', () => {
  it('derives a namespaced 64-bit ID from the source anchor', () => {
    const result = transformJsx('const Message = () => <article />', options)

    expect(uiContractForDescriptor(result.descriptors[0]).id).toMatch(/^ui-[0-9a-f]{16}$/)
  })

  it('rejects a truncated-hash collision', () => {
    const result = transformJsx('const Message = () => <article />', options)
    const descriptor = result.descriptors[0]
    const collision = {
      ...descriptor,
      anchorHash: `${descriptor.anchorHash.slice(0, 16)}ffffffff`,
      sourceOffset: descriptor.sourceOffset + 1
    }

    expect(() => assertUniqueUiNodeIds([descriptor, collision])).toThrow('UI node ID collision')
  })
})
