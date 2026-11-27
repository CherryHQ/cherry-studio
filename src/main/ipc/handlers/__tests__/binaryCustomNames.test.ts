import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BinaryInstallByNameRequest, BinaryRemoveRequest } from '@shared/types/binary'

const { customToolNames, binaryManager, codeCliService } = vi.hoisted(() => {
  const customToolNames = new Set<string>()
  return {
    customToolNames,
    binaryManager: {
      installByName: async ({ name }: BinaryInstallByNameRequest) => {
        customToolNames.add(name)
      },
      removeTool: async ({ name }: BinaryRemoveRequest) => {
        customToolNames.delete(name)
        return { status: 'removed' as const }
      }
    },
    codeCliService: {
      installCli: vi.fn().mockRejectedValue(new Error('Custom tools are not managed Code CLIs')),
      removeCli: vi.fn().mockRejectedValue(new Error('Custom tools are not managed Code CLIs'))
    }
  }
})

vi.mock('@application', async () => {
  const { defaultServiceInstances, mockApplicationFactory } = await import('@test-mocks/main/application')
  const services = { ...defaultServiceInstances, BinaryManager: binaryManager, CodeCliService: codeCliService }
  return mockApplicationFactory(services)
})

import { binaryHandlers } from '../binary'

const context = { senderId: 'w1' }

beforeEach(() => customToolNames.clear())

describe.each(['constructor', 'toString'])('custom binary named %s', (name) => {
  it('installs the custom tool without requiring a Code CLI preset', async () => {
    await expect(binaryHandlers['binary.install_tool']({ name }, context)).resolves.toBeUndefined()

    expect(customToolNames.has(name)).toBe(true)
  })

  it('removes the custom tool without Code CLI post-removal checks', async () => {
    customToolNames.add(name)

    await expect(binaryHandlers['binary.remove_tool']({ name, definitionOnly: true }, context)).resolves.toEqual({
      status: 'removed'
    })
    expect(customToolNames.has(name)).toBe(false)
  })
})
