import { fileURLToPath } from 'node:url'

import { application } from '@application'
import { jobFileRefTable } from '@data/db/schemas/fileRelations'
import { jobTable } from '@data/db/schemas/job'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { fileEntryService } from '@data/services/FileEntryService'
import { jobService } from '@data/services/JobService'
import { modelService } from '@data/services/ModelService'
import { providerRegistryService } from '@data/services/ProviderRegistryService'
import { providerService } from '@data/services/ProviderService'
import { executeImageRequest } from '@main/ai/utils/executeImageRequest'
import { prepareImageExecution } from '@main/ai/utils/prepareImageRequest'
import { JobManager } from '@main/core/job/JobManager'
import { runStartupRecovery } from '@main/core/job/runtime/recovery'
import { BaseService } from '@main/core/lifecycle/BaseService'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'
import type { CreateInternalEntryIpcParams } from '@shared/types/file'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { net } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { imageGenerationJobHandler } from '../imageGenerationJobHandler'

const { featureServices } = vi.hoisted(() => ({ featureServices: new Map<string, unknown>() }))
vi.mock('@application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  const mock = mockApplicationFactory()
  const get = mock.application.get.getMockImplementation()!
  mock.application.get = vi.fn((name) => (featureServices.has(name) ? featureServices.get(name) : get(name)))
  return mock
})

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jD1sAAAAASUVORK5CYII='
const IMAGE = `data:image/png;base64,${PNG}`
const PROVIDER = 'image-job-connection'
const requests: Request[] = []

describe('prepared image Job execution', () => {
  const dbh = setupTestDatabase()
  let manager: JobManager
  let storedBytes: Map<string, string>

  beforeEach(async () => {
    BaseService.resetInstances()
    featureServices.clear()
    requests.length = 0
    storedBytes = new Map()
    manager = new JobManager()
    featureServices.set('JobManager', manager)
    featureServices.set('PowerService', { preventSleep: () => ({ dispose: () => {} }) })
    featureServices.set('FileManager', {
      async createInternalEntry(params: CreateInternalEntryIpcParams) {
        if (params.source !== 'base64') throw new Error('URL inputs must remain URLs for the vendor')
        const entry = fileEntryService.create({
          id: crypto.randomUUID(),
          origin: 'internal',
          name: 'image',
          ext: 'png',
          size: 68,
          cleanupPolicy: params.cleanupPolicy
        })
        storedBytes.set(entry.id, params.data.slice(params.data.indexOf(',') + 1))
        return entry
      },
      async read(id: string) {
        fileEntryService.getById(id)
        const content = storedBytes.get(id)
        if (!content) throw new Error('Missing test blob')
        return { content, mime: 'image/png' }
      },
      async permanentDelete(id: string) {
        fileEntryService.delete(id)
        storedBytes.delete(id)
      }
    })
    vi.mocked(application.getPath).mockImplementation((key, filename) => {
      if (key === 'feature.provider_registry.data')
        return fileURLToPath(
          new URL(`../../../../../../../packages/provider-registry/data/${filename}`, import.meta.url)
        )
      if (key === 'app.root') return fileURLToPath(new URL(`../../../../../../../${filename ?? ''}`, import.meta.url))
      return `/mock/${key}/${filename ?? ''}`
    })
    providerRegistryService.clearCache()
    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: PROVIDER,
        presetProviderId: 'dashscope',
        name: 'Image connection',
        orderKey: 'a0',
        endpointConfigs: {
          [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://vendor.example/compatible-mode/v1' }
        },
        apiKeys: [{ id: 'key', key: 'initial-secret', isEnabled: true }],
        isEnabled: true
      })
      .run()
    manager.registerHandler('image-generation.generate', imageGenerationJobHandler)
    await manager._doInit()
    let translation = false
    // Task envelope: https://help.aliyun.com/en/model-studio/manage-asynchronous-tasks (retrieved 2026-09-09).
    vi.mocked(net.fetch).mockImplementation(async (input, init) => {
      const request = new Request(input, init)
      requests.push(request)
      if (request.url.endsWith('/cancel')) return Response.json('cancel-request-id')
      if (request.method === 'POST') {
        translation = (await request.clone().json()).model === 'qwen-mt-image'
        return Response.json({ output: { task_id: 'accepted-task' } })
      }
      // Inline result fixtures isolate Job persistence; vendor URL/result schemas have separate boundary tests.
      return Response.json({
        output: {
          task_status: 'SUCCEEDED',
          ...(translation ? { image_url: IMAGE } : { results: [{ url: IMAGE }] })
        }
      })
    })
  })

  afterEach(async () => {
    await manager._doStop()
    await manager._doDestroy()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    providerRegistryService.clearCache()
  })

  function prepared(modelId = 'wanx2-1-t2i-turbo', images: string[] = []) {
    const catalogModel = providerRegistryService
      .listProviderRegistryModels({ providerId: PROVIDER })
      .find((model) => model.presetModelId === modelId)
    if (!catalogModel?.apiModelId) throw new Error(`Missing served model: ${modelId}`)
    const id = catalogModel.id
    dbh.db
      .insert(userModelTable)
      .values({
        id,
        providerId: PROVIDER,
        modelId: catalogModel.apiModelId,
        presetModelId: modelId,
        orderKey: 'a0',
        capabilities: [MODEL_CAPABILITY.IMAGE_GENERATION],
        supportsStreaming: false
      })
      .run()
    const provider = providerService.getByProviderId(PROVIDER)
    const model = modelService.getByKey(PROVIDER, catalogModel.apiModelId)
    if (!provider || !model) throw new Error('Missing seeded connection')
    return prepareImageExecution(
      {
        uniqueModelId: id,
        prompt: 'a cat',
        paramValues:
          modelId === 'qwen-mt-image'
            ? { sourceLang: 'auto', targetLang: 'en' }
            : modelId === 'wanx2-1-imageedit'
              ? { function: 'stylization_all' }
              : {},
        inputImages: images,
        operation: 'generate',
        cleanupPolicy: 'delete_when_unreferenced'
      },
      provider,
      model
    )
  }

  it('persists the accepted task ID before any query and reads credentials only at execution', async () => {
    const request = prepared()
    dbh.db
      .update(userProviderTable)
      .set({ apiKeys: [{ id: 'key', key: 'rotated-secret', isEnabled: true }] })
      .where(eq(userProviderTable.providerId, PROVIDER))
      .run()
    const fetch = vi.mocked(net.fetch).getMockImplementation()!
    vi.mocked(net.fetch).mockImplementation(async (input, init) => {
      const http = new Request(input, init)
      expect(http.headers.get('authorization')).toBe('Bearer rotated-secret')
      if (http.method === 'GET') expect(jobService.list({})[0].metadata).toEqual({ taskId: 'accepted-task' })
      return fetch(input, init)
    })
    const result = await executeImageRequest(request, undefined)
    expect(result.files).toHaveLength(1)
    expect(fileEntryService.getById(result.files[0].id)).toMatchObject({ origin: 'internal', size: 68 })
    const [job] = jobService.list({})
    expect(job.status).toBe('completed')
    expect(job.maxAttempts).toBe(1)
    expect(JSON.stringify(job.input)).not.toMatch(/initial-secret|rotated-secret|Authorization|apiKey/)
    expect(requests.filter((request) => request.method === 'POST')).toHaveLength(1)
  })

  it('rejects a queued request after its configured endpoint changes', async () => {
    const request = prepared()
    dbh.db
      .update(userProviderTable)
      .set({
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://changed.example/v1' } }
      })
      .where(eq(userProviderTable.providerId, PROVIDER))
      .run()
    await expect(executeImageRequest(request, undefined)).rejects.toThrow(/connection.*changed/i)
    expect(requests).toEqual([])
  })

  it('keeps the original public URL for the URL-only Qwen translation protocol', async () => {
    // https://help.aliyun.com/zh/model-studio/qwen-mt-image-api (retrieved 2026-09-09).
    const url = 'https://images.example/reference.png'
    const result = await executeImageRequest(prepared('qwen-mt-image', [url]), undefined)
    expect(result.files).toHaveLength(1)
    const body = await requests[0].json()
    expect(body.input.image_url).toBe(url)
    expect(dbh.db.select().from(jobFileRefTable).all()).toEqual([])
  })

  it('holds inline inputs by real job_file_ref rows before the vendor sees them', async () => {
    const request = prepared('wanx2-1-imageedit', [IMAGE])
    const fetch = vi.mocked(net.fetch).getMockImplementation()!
    vi.mocked(net.fetch).mockImplementation(async (input, init) => {
      if (init?.method === 'POST') {
        const [ref] = dbh.db.select().from(jobFileRefTable).all()
        expect(ref.role).toBe('input')
        expect(fileEntryService.getById(ref.fileEntryId).cleanupPolicy).toBe('delete_when_unreferenced')
        expect(jobService.getById(ref.sourceId)?.status).toBe('running')
      }
      return fetch(input, init)
    })
    await executeImageRequest(request, undefined)
    expect((await requests[0].json()).input.base_image_url).toBe(IMAGE)
  })

  it('abandons old persisted payloads on restart without interpreting or resubmitting them', () => {
    const row = jobService.create({
      type: 'image-generation.generate',
      status: 'running',
      queue: 'old-images',
      scheduledAt: 0,
      input: { uniqueModelId: 'old::model', inputFileIds: ['obsolete'] },
      maxAttempts: 1,
      metadata: { taskId: 'previous-process-task' }
    })
    runStartupRecovery(
      new Map([
        [
          'image-generation.generate',
          {
            recovery: imageGenerationJobHandler.recovery,
            execute: async () => {
              throw new Error('Recovery must not execute an abandoned payload')
            }
          }
        ]
      ]),
      () => false
    )
    const [persisted] = dbh.db.select().from(jobTable).where(eq(jobTable.id, row.id)).all()
    expect(persisted.status).toBe('cancelled')
    expect(persisted.metadata).toEqual({ taskId: 'previous-process-task' })
    expect(requests).toEqual([])
  })

  it('cancels an accepted task once when metadata persistence fails, before issuing a query', async () => {
    vi.spyOn(jobService, 'setMetadataTx').mockImplementationOnce(() => {
      throw new Error('metadata disk full')
    })
    await expect(executeImageRequest(prepared(), undefined)).rejects.toThrow('metadata disk full')
    expect(requests.map((request) => request.method)).toEqual(['POST', 'POST'])
    // https://help.aliyun.com/en/model-studio/manage-asynchronous-tasks (retrieved 2026-09-09).
    expect(new URL(requests[1].url).pathname).toBe('/api/v1/tasks/accepted-task/cancel')
    expect(requests[1].signal.aborted).toBe(false)
    expect(jobService.list({})[0].metadata).toEqual({})
  })

  it('cancels an accepted task on a terminal query protocol error without resubmitting', async () => {
    const fetch = vi.mocked(net.fetch).getMockImplementation()!
    vi.mocked(net.fetch).mockImplementation(async (input, init) => {
      const response = await fetch(input, init)
      return new Request(input, init).method === 'GET'
        ? Response.json({ output: { task_status: 'UNKNOWN' } })
        : response
    })
    await expect(executeImageRequest(prepared(), undefined)).rejects.toThrow()
    expect(requests.map((request) => request.method)).toEqual(['POST', 'GET', 'POST'])
    expect(requests[2].url).toMatch(/\/tasks\/accepted-task\/cancel$/)
    expect(jobService.list({})[0].status).toBe('failed')
  })

  it('uses an independent cancellation request when the caller aborts during query', async () => {
    const controller = new AbortController()
    const request = prepared()
    request.request.requestOptions = { signal: controller.signal }
    const fetch = vi.mocked(net.fetch).getMockImplementation()!
    vi.mocked(net.fetch).mockImplementation(async (input, init) => {
      const response = await fetch(input, init)
      if (new Request(input, init).method === 'GET') {
        controller.abort()
        controller.abort()
        throw new DOMException('cancelled', 'AbortError')
      }
      return response
    })
    await expect(executeImageRequest(request, undefined)).rejects.toMatchObject({ name: 'AbortError' })
    expect(requests.map((request) => request.method)).toEqual(['POST', 'GET', 'POST'])
    expect(requests[2].signal.aborted).toBe(false)
    expect(jobService.list({})[0].status).toBe('cancelled')
  })

  it('does not cancel a remotely completed task when local output persistence fails', async () => {
    vi.spyOn(fileEntryService, 'create').mockImplementationOnce(() => {
      throw new Error('output disk full')
    })
    await expect(executeImageRequest(prepared(), undefined)).rejects.toThrow('output disk full')
    expect(requests.map((request) => request.method)).toEqual(['POST', 'GET'])
    expect(jobService.list({})[0].status).toBe('failed')
  })

  it('does not blindly retry a submission whose response was lost', async () => {
    vi.mocked(net.fetch).mockImplementation(async (input, init) => {
      requests.push(new Request(input, init))
      throw new TypeError('fetch failed')
    })
    await expect(executeImageRequest(prepared(), undefined)).rejects.toThrow('fetch failed')
    expect(requests).toHaveLength(1)
    expect(jobService.list({})[0]).toMatchObject({ status: 'failed', maxAttempts: 1, metadata: {} })
  })

  it.each(['before', 'input write'] as const)(
    'does not enqueue after cancellation %s and compensates scratch inputs',
    async (stage) => {
      const controller = new AbortController()
      const request = prepared('wanx2-1-imageedit', [IMAGE])
      request.request.requestOptions = { signal: controller.signal }
      if (stage === 'before') controller.abort()
      else {
        const create = fileEntryService.create.bind(fileEntryService)
        vi.spyOn(fileEntryService, 'create').mockImplementation((params) => {
          const entry = create(params)
          controller.abort()
          return entry
        })
      }
      await expect(executeImageRequest(request, undefined)).rejects.toMatchObject({ name: 'AbortError' })
      expect(jobService.list({})).toEqual([])
      expect(storedBytes.size).toBe(0)
      expect(requests).toEqual([])
    }
  )

  it.each([false, true])(
    'delivers a nonempty downloaded subset, or fails when all downloads fail (%s)',
    async (allFail) => {
      const fetch = vi.mocked(net.fetch).getMockImplementation()!
      vi.mocked(net.fetch).mockImplementation(async (input, init) => {
        const request = new Request(input, init)
        if (request.url.startsWith('https://images.example/')) {
          expect(request.headers.has('authorization')).toBe(false)
          return request.url.endsWith('good.png') && !allFail
            ? new Response(Buffer.from(PNG, 'base64'), { headers: { 'content-type': 'image/png' } })
            : new Response('not found', { status: 404 })
        }
        const response = await fetch(input, init)
        return request.method === 'GET'
          ? Response.json({
              output: {
                task_status: 'SUCCEEDED',
                results: [{ url: 'https://images.example/good.png' }, { url: 'https://images.example/bad.png' }]
              }
            })
          : response
      })
      const result = executeImageRequest(prepared(), undefined)
      if (allFail) {
        await expect(result).rejects.toThrow('all downloads failed')
      } else {
        const { files } = await result
        expect(files).toHaveLength(1)
        expect(storedBytes.get(files[0].id)).toBe(PNG)
      }
      expect(requests.map((request) => request.method)).toEqual(['POST', 'GET'])
    }
  )
})
