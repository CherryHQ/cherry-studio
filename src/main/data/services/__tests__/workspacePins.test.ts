import '@data/services/AgentSessionMessageService'
import '@data/services/AgentTaskService'
import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { pinService } from '@data/services/PinService'
import { CreatePinSchema } from '@shared/data/api/schemas/pins'

describe('workspace pins', () => {
  setupTestDatabase()

  it('persists workspace pins, supports unpin, and purges pins when an empty workspace is deleted', () => {
    const workspace = agentWorkspaceService.findOrCreateByPath('/tmp/pinned-workspace')
    const other = agentWorkspaceService.findOrCreateByPath('/tmp/other-pinned-workspace')
    const dto = CreatePinSchema.parse({ entityType: 'workspace', entityId: workspace.id })
    const first = pinService.pin(dto)
    pinService.pin({ entityType: 'workspace', entityId: other.id })
    expect(pinService.listByEntityType('workspace').map((pin) => pin.entityId)).toEqual([workspace.id, other.id])
    pinService.unpin(first.id)
    expect(pinService.listByEntityType('workspace').map((pin) => pin.entityId)).toEqual([other.id])
    pinService.pin(dto)
    agentSessionService.deleteWorkspaceCascade(workspace.id)
    expect(pinService.listByEntityType('workspace').map((pin) => pin.entityId)).toEqual([other.id])
    expect(agentWorkspaceService.list().map((item) => item.id)).toEqual([other.id])
  })
})
