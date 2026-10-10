import { randomUUID } from 'node:crypto'

import { Mutex } from 'async-mutex'

import { application } from '@application'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { skillErrorCodes } from '@shared/ipc/errors/skill'
import type { MarketplaceSkillMember, SkillSubscriptionSnapshot } from '@shared/types/skillMarketplace'
import { normalizeSubscriptionUrl, skillInstallIdentity } from '@shared/utils/skillSubscription'

import { downloadSkillPackage } from './cherrySkillMarketplace'
import { safeRemoveDirectory } from './skillPaths'
import { skillService } from './SkillService'
import { readSkillSubscription } from './skillSubscriptionCatalog'

const SOURCES_KEY = 'ui.marketplace.skill_sources'
const CACHE_KEY = 'skill.subscription.catalogs'

@Injectable('SkillSubscriptionService')
@ServicePhase(Phase.WhenReady)
export class SkillSubscriptionService extends BaseService {
  private readonly mutations = new Mutex()
  private readonly refreshes = new Map<string, Promise<SkillSubscriptionSnapshot>>()
  private readonly installs = new Map<string, ReturnType<typeof skillService.installSubscription>>()
  private readonly controller = new AbortController()

  protected onStop() {
    this.controller.abort()
  }

  private sources() {
    return application.get('PreferenceService').get(SOURCES_KEY)
  }
  private catalogs() {
    return application.get('CacheService').getPersist(CACHE_KEY)
  }

  list(sourceId: string): SkillSubscriptionSnapshot | null {
    this.requireSource(sourceId)
    return this.catalogs()[sourceId] ?? null
  }

  private requireSource(sourceId: string) {
    const source = this.sources().find((item) => item.id === sourceId)
    if (!source) throw new IpcError(skillErrorCodes.SUBSCRIPTION_REMOVED)
    return source
  }

  add(rawUrl: string) {
    return this.mutations.runExclusive(async () => {
      const url = normalizeSubscriptionUrl(rawUrl)
      if (!url) throw new IpcError(skillErrorCodes.SUBSCRIPTION_INVALID)
      const existing = this.sources().find((source) => source.url === url)
      if (existing) return existing
      const snapshot = await readSkillSubscription(
        {
          id: randomUUID(),
          url,
          name: '',
          kind: 'json',
          createdAt: Date.now()
        },
        this.controller.signal
      )
      if (!snapshot.items.length) throw new IpcError(skillErrorCodes.SUBSCRIPTION_EMPTY)
      this.controller.signal.throwIfAborted()
      application.get('CacheService').setPersist(CACHE_KEY, { ...this.catalogs(), [snapshot.source.id]: snapshot })
      await application.get('PreferenceService').set(SOURCES_KEY, [...this.sources(), snapshot.source])
      return snapshot.source
    })
  }

  refresh(sourceId: string) {
    const pending = this.refreshes.get(sourceId)
    if (pending) return pending
    const source = this.requireSource(sourceId)
    const task = readSkillSubscription(source, this.controller.signal)
      .then((snapshot) =>
        this.mutations.runExclusive(async () => {
          this.controller.signal.throwIfAborted()
          this.requireSource(sourceId)
          application.get('CacheService').setPersist(CACHE_KEY, { ...this.catalogs(), [sourceId]: snapshot })
          await application.get('PreferenceService').set(
            SOURCES_KEY,
            this.sources().map((item) => (item.id === sourceId ? snapshot.source : item))
          )
          return snapshot
        })
      )
      .finally(() => this.refreshes.delete(sourceId))
    this.refreshes.set(sourceId, task)
    return task
  }

  remove(sourceId: string) {
    return this.mutations.runExclusive(async () => {
      await application.get('PreferenceService').set(
        SOURCES_KEY,
        this.sources().filter((source) => source.id !== sourceId)
      )
      const cache = { ...this.catalogs() }
      delete cache[sourceId]
      application.get('CacheService').setPersist(CACHE_KEY, cache)
    })
  }

  private item(sourceId: string, itemId: string) {
    const item = this.list(sourceId)?.items.find((entry) => entry.id === itemId)
    if (!item) throw new IpcError(skillErrorCodes.SUBSCRIPTION_REMOVED)
    return item
  }

  private async rememberMembers(sourceId: string, itemId: string, members: MarketplaceSkillMember[]) {
    await this.mutations.runExclusive(() => {
      if (this.controller.signal.aborted || !this.sources().some((source) => source.id === sourceId)) return
      const snapshot = this.catalogs()[sourceId]
      if (!snapshot) return
      application.get('CacheService').setPersist(CACHE_KEY, {
        ...this.catalogs(),
        [sourceId]: {
          ...snapshot,
          items: snapshot.items.map((item) =>
            item.id === itemId
              ? { ...item, members, membersKnown: true, isCollection: members.some((member) => member.path !== '') }
              : item
          )
        }
      })
    })
  }

  async detail(sourceId: string, itemId: string) {
    const item = this.item(sourceId, itemId)
    if (!item.membersKnown && item.subscription?.kind === 'zip') {
      const downloaded = await downloadSkillPackage(item.subscription.url)
      try {
        await this.rememberMembers(
          sourceId,
          itemId,
          downloaded.directories.map(({ path, name }) => ({ path, name }))
        )
      } finally {
        await safeRemoveDirectory(downloaded.tempDir)
      }
    }
    return this.item(sourceId, itemId)
  }

  install(sourceId: string, itemId: string) {
    const item = this.item(sourceId, itemId)
    const key = skillInstallIdentity(item.subscription!.url)
    let task = this.installs.get(key)
    if (!task) {
      task = skillService.installSubscription(item).finally(() => this.installs.delete(key))
      this.installs.set(key, task)
    }
    return task.then(async (result) => {
      await this.rememberMembers(sourceId, itemId, result.members)
      return result
    })
  }
}
