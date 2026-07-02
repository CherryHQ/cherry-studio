import { afterEach, describe, expect, it } from 'vitest'

import { BaseService } from '../BaseService'
import { DependsOn, Injectable } from '../decorators'
import { LifecycleManager } from '../LifecycleManager'
import type { ProfileActivatable, ProfileActivationContext } from '../profileActivation'
import { ServiceContainer } from '../ServiceContainer'
import { Phase } from '../types'

const order: string[] = []

// DbLike is a dependency of WriterLike, so it initializes first → leads the
// participant order (activate first, deactivate last).
@Injectable('DbLike')
class DbLike extends BaseService implements ProfileActivatable {
  async onProfileActivate(ctx: ProfileActivationContext) {
    order.push(`activate:Db:${ctx.profileId}`)
  }
  async onProfileDeactivate() {
    order.push('deactivate:Db')
  }
}

@Injectable('WriterLike')
@DependsOn(['DbLike'])
class WriterLike extends BaseService implements ProfileActivatable {
  async onProfileActivate(ctx: ProfileActivationContext) {
    order.push(`activate:Writer:${ctx.profileId}`)
  }
  async onProfileDeactivate() {
    order.push('deactivate:Writer')
  }
}

@Injectable('PlainLike')
class PlainLike extends BaseService {}

afterEach(() => {
  LifecycleManager.reset()
  ServiceContainer.reset()
  BaseService.resetInstances()
})

async function setup(): Promise<LifecycleManager> {
  order.length = 0
  const manager = LifecycleManager.getInstance()
  const container = manager['container'] as ServiceContainer
  container.register(DbLike)
  container.register(WriterLike)
  container.register(PlainLike)
  await manager.startPhase(Phase.WhenReady)
  return manager
}

describe('LifecycleManager profile orchestration', () => {
  it('getProfileParticipants returns only participants, in dependency order', async () => {
    const manager = await setup()
    const names = manager.getProfileParticipants().map((s) => s.constructor.name)
    expect(names).toEqual(['DbLike', 'WriterLike']) // PlainLike excluded
  })

  it('activates forward (Db first) and deactivates in reverse (Db last)', async () => {
    const manager = await setup()
    await manager.activateProfile({ profileId: 'P1' })
    expect(order).toEqual(['activate:Db:P1', 'activate:Writer:P1'])

    order.length = 0
    await manager.deactivateProfile()
    expect(order).toEqual(['deactivate:Writer', 'deactivate:Db'])
  })
})
