/**
 * MemoryService — lifecycle-managed main-process service that owns the active
 * memory provider and exposes all memory operations over IPC.
 *
 * The active provider is resolved from `feature.memory.provider` preference and
 * hot-swapped whenever that preference changes.
 *
 * IPC handlers are registered via `this.ipcHandle()` (auto-cleaned on destroy).
 */

import { application } from '@application'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import { IpcChannel } from '@shared/IpcChannel'
import type {
  AddMemoryOptions,
  MemoryDeleteAllOptions,
  MemoryListOptions,
  MemoryProviderCapabilities,
  MemorySearchOptions,
  ReflectOptions
} from '@shared/memory'
import type { MemoryProviderId } from '@shared/memory'
import type { MemoryProvider } from '@shared/memory/provider'
import * as z from 'zod'

import { memoryProviderRegistry } from './providers/MemoryProviderRegistry'
import { NullProvider } from './providers/NullProvider'

const logger = loggerService.withContext('MemoryService')

// ---------------------------------------------------------------------------
// Zod schemas for IPC payload validation
// ---------------------------------------------------------------------------

const AddPayloadSchema = z.object({
  content: z.union([z.string(), z.array(z.string())]),
  options: z.record(z.string(), z.unknown()).optional()
})

const SearchPayloadSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  options: z.record(z.string(), z.unknown()).optional()
})

const ReflectPayloadSchema = z.object({
  query: z.string().trim().min(1).max(2000),
  options: z.record(z.string(), z.unknown()).optional()
})

const ListPayloadSchema = z.object({
  options: z.record(z.string(), z.unknown()).optional()
})

const GetPayloadSchema = z.object({
  id: z.string().trim().min(1)
})

const UpdatePayloadSchema = z.object({
  id: z.string().trim().min(1),
  memory: z.string().trim().min(1),
  metadata: z.record(z.string(), z.unknown()).optional()
})

const DeletePayloadSchema = z.object({
  id: z.string().trim().min(1)
})

const DeleteAllPayloadSchema = z.object({
  options: z.record(z.string(), z.unknown()).optional()
})

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

@Injectable('MemoryService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['PreferenceService'])
export class MemoryService extends BaseService {
  private provider: MemoryProvider = new NullProvider()
  private currentProviderId: MemoryProviderId = 'off'

  protected async onInit(): Promise<void> {
    // Lazy-register provider factories to avoid loading heavy deps until needed.
    await this.registerProviderFactories()

    // Activate the configured provider.
    const providerId = this.getPreference('feature.memory.provider') as MemoryProviderId
    await this.activateProvider(providerId)

    // Hot-swap when the user changes the provider setting.
    this.registerDisposable(
      application.get('PreferenceService').subscribeChange('feature.memory.provider', async (newId) => {
        await this.activateProvider(newId as MemoryProviderId)
      })
    )

    this.registerIpcHandlers()
  }

  // ---------------------------------------------------------------------------
  // Provider lifecycle
  // ---------------------------------------------------------------------------

  private async registerProviderFactories(): Promise<void> {
    // HindsightProvider and LibSqlProvider are registered lazily to avoid
    // importing heavy dependencies until actually needed.
    memoryProviderRegistry.register('hindsight', async () => {
      const { HindsightProvider } = await import('./providers/HindsightProvider')
      return new HindsightProvider()
    })

    memoryProviderRegistry.register('libsql', async () => {
      const { LibSqlProvider } = await import('./providers/LibSqlProvider')
      return new LibSqlProvider()
    })
  }

  private async activateProvider(id: MemoryProviderId): Promise<void> {
    if (id === this.currentProviderId) return

    // Tear down current provider.
    try {
      await this.provider.destroy?.()
    } catch (err) {
      logger.warn('Error destroying previous memory provider', err as Error)
    }

    // Build and initialise the new provider.
    try {
      const next = await memoryProviderRegistry.create(id)
      await next.init()
      this.provider = next
      this.currentProviderId = id
      logger.info(`Memory provider activated: ${id}`)
    } catch (err) {
      logger.error(`Failed to activate memory provider '${id}', falling back to NullProvider`, err as Error)
      this.provider = new NullProvider()
      this.currentProviderId = 'off'
    }
  }

  // ---------------------------------------------------------------------------
  // Public accessors (used by IPC handlers)
  // ---------------------------------------------------------------------------

  getCapabilities(): MemoryProviderCapabilities {
    return this.provider.capabilities
  }

  // ---------------------------------------------------------------------------
  // IPC registration
  // ---------------------------------------------------------------------------

  private registerIpcHandlers(): void {
    // -- Capabilities & health --
    this.ipcHandle(IpcChannel.Memory_Capabilities, (_event) => this.getCapabilities())

    this.ipcHandle(IpcChannel.Memory_HealthCheck, async () => {
      try {
        return await this.provider.healthCheck()
      } catch {
        return false
      }
    })

    // -- CRUD --
    this.ipcHandle(IpcChannel.Memory_Add, async (_event, payload: unknown) => {
      const { content, options } = AddPayloadSchema.parse(payload)
      return await this.provider.add(content, options as AddMemoryOptions | undefined)
    })

    this.ipcHandle(IpcChannel.Memory_Search, async (_event, payload: unknown) => {
      const { query, options } = SearchPayloadSchema.parse(payload)
      return await this.provider.search(query, options as MemorySearchOptions | undefined)
    })

    this.ipcHandle(IpcChannel.Memory_List, async (_event, payload: unknown) => {
      const { options } = ListPayloadSchema.parse(payload ?? {})
      return await this.provider.list(options as MemoryListOptions | undefined)
    })

    this.ipcHandle(IpcChannel.Memory_Get, async (_event, payload: unknown) => {
      const { id } = GetPayloadSchema.parse(payload)
      return await this.provider.get(id)
    })

    this.ipcHandle(IpcChannel.Memory_Update, async (_event, payload: unknown) => {
      const { id, memory, metadata } = UpdatePayloadSchema.parse(payload)
      return await this.provider.update(id, memory, metadata)
    })

    this.ipcHandle(IpcChannel.Memory_Delete, async (_event, payload: unknown) => {
      const { id } = DeletePayloadSchema.parse(payload)
      return await this.provider.delete(id)
    })

    this.ipcHandle(IpcChannel.Memory_DeleteAll, async (_event, payload: unknown) => {
      const { options } = DeleteAllPayloadSchema.parse(payload ?? {})
      return await this.provider.deleteAll(options as MemoryDeleteAllOptions | undefined)
    })

    // -- Reflect (optional — Hindsight-only, Memory Browser UI only) --
    this.ipcHandle(IpcChannel.Memory_Reflect, async (_event, payload: unknown) => {
      if (!this.provider.reflect) {
        throw new Error('Current memory provider does not support reflect.')
      }
      const { query, options } = ReflectPayloadSchema.parse(payload)
      return await this.provider.reflect({ query, ...(options as Partial<ReflectOptions>) })
    })

    // -- User listing --
    this.ipcHandle(IpcChannel.Memory_ListUsers, async () => {
      return await this.provider.listUsers()
    })
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private getPreference(key: UnifiedPreferenceKeyType) {
    return application.get('PreferenceService').get(key)
  }
}
