import { beforeEach, describe, expect, it, vi } from 'vitest'

const { listByEntityTypeMock, getByIdMock, pinMock, unpinMock, reorderMock, reorderBatchMock } = vi.hoisted(() => ({
  listByEntityTypeMock: vi.fn(),
  getByIdMock: vi.fn(),
  pinMock: vi.fn(),
  unpinMock: vi.fn(),
  reorderMock: vi.fn(),
  reorderBatchMock: vi.fn()
}))

vi.mock('@data/services/PinService', () => ({
  pinService: {
    listByEntityType: listByEntityTypeMock,
    getById: getByIdMock,
    pin: pinMock,
    unpin: unpinMock,
    reorder: reorderMock,
    reorderBatch: reorderBatchMock
  }
}))

import { pinHandlers } from '../pins'

const PIN_ID = '11111111-1111-4111-8111-111111111111'
const OTHER_PIN_ID = '22222222-2222-4222-8222-222222222222'
const ENTITY_ID = '33333333-3333-4333-8333-333333333333'
const MODEL_ID = 'openai::gpt-4o'
const AGENT_ID = 'agent_1700000000000_abc123xyz'

describe('pinHandlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('/pins', () => {
    it('should delegate GET to pinService.listByEntityType with the parsed entityType', async () => {
      listByEntityTypeMock.mockResolvedValueOnce([{ id: PIN_ID, entityType: 'topic', entityId: ENTITY_ID }])

      const result = await pinHandlers['/pins'].GET({
        query: { entityType: 'topic' }
      } as never)

      expect(listByEntityTypeMock).toHaveBeenCalledWith('topic')
      expect(result).toEqual([{ id: PIN_ID, entityType: 'topic', entityId: ENTITY_ID }])
    })

    it('should accept model as a pin entity type when listing', async () => {
      listByEntityTypeMock.mockResolvedValueOnce([{ id: PIN_ID, entityType: 'model', entityId: MODEL_ID }])

      const result = await pinHandlers['/pins'].GET({
        query: { entityType: 'model' }
      } as never)

      expect(listByEntityTypeMock).toHaveBeenCalledWith('model')
      expect(result).toEqual([{ id: PIN_ID, entityType: 'model', entityId: MODEL_ID }])
    })

    it('should reject GET when query.entityType is missing', async () => {
      await expect(pinHandlers['/pins'].GET({ query: {} } as never)).rejects.toHaveProperty('name', 'ZodError')
      expect(listByEntityTypeMock).not.toHaveBeenCalled()
    })

    it('should reject GET when query.entityType is not a known enum value', async () => {
      await expect(pinHandlers['/pins'].GET({ query: { entityType: 'unknown' } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )
      expect(listByEntityTypeMock).not.toHaveBeenCalled()
    })

    it('should accept model as a pin entity type when listing', async () => {
      listByEntityTypeMock.mockResolvedValueOnce([{ id: PIN_ID, entityType: 'model', entityId: MODEL_ID }])

      const result = await pinHandlers['/pins'].GET({
        query: { entityType: 'model' }
      } as never)

      expect(listByEntityTypeMock).toHaveBeenCalledWith('model')
      expect(result).toEqual([{ id: PIN_ID, entityType: 'model', entityId: MODEL_ID }])
    })

    it('should delegate POST with parsed body (idempotency returns the same row on repeat calls)', async () => {
      const row = {
        id: PIN_ID,
        entityType: 'topic',
        entityId: ENTITY_ID,
        orderKey: 'a0'
      }
      pinMock.mockResolvedValue(row)

      const firstCall = { body: { entityType: 'topic', entityId: ENTITY_ID } }
      await expect(pinHandlers['/pins'].POST(firstCall as never)).resolves.toMatchObject({ id: PIN_ID })
      await expect(pinHandlers['/pins'].POST(firstCall as never)).resolves.toMatchObject({ id: PIN_ID })

      expect(pinMock).toHaveBeenNthCalledWith(1, { entityType: 'topic', entityId: ENTITY_ID })
      expect(pinMock).toHaveBeenNthCalledWith(2, { entityType: 'topic', entityId: ENTITY_ID })
    })

    it('should accept non-UUID agent ids because agent storage owns its own id format', async () => {
      const row = {
        id: PIN_ID,
        entityType: 'agent',
        entityId: AGENT_ID,
        orderKey: 'a0'
      }
      pinMock.mockResolvedValue(row)

      await expect(
        pinHandlers['/pins'].POST({
          body: { entityType: 'agent', entityId: AGENT_ID }
        } as never)
      ).resolves.toMatchObject(row)

      expect(pinMock).toHaveBeenCalledWith({ entityType: 'agent', entityId: AGENT_ID })
    })

    it('should accept UniqueModelId entityId values for model pins', async () => {
      pinMock.mockResolvedValueOnce({ id: PIN_ID, entityType: 'model', entityId: MODEL_ID })

      await expect(
        pinHandlers['/pins'].POST({
          body: { entityType: 'model', entityId: MODEL_ID }
        } as never)
      ).resolves.toMatchObject({ id: PIN_ID, entityType: 'model', entityId: MODEL_ID })

      expect(pinMock).toHaveBeenCalledWith({ entityType: 'model', entityId: MODEL_ID })
    })

    it('should reject POST with an invalid entityType before calling the service', async () => {
      await expect(
        pinHandlers['/pins'].POST({
          body: { entityType: 'bogus', entityId: ENTITY_ID }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(pinMock).not.toHaveBeenCalled()
    })

    it('should reject POST with an empty entityId before calling the service', async () => {
      // Non-UUID strings are accepted at the schema layer because EntityIdSchema unions in
      // AgentIdSchema (`string().min(1)`); deeper validation that a topic id actually exists
      // is the service's job. The schema only guards the structural floor — empty string.
      // TODO(agent-uuid-migration): once upstream agent ids migrate to UUID, restore this
      //   case to use 'not-a-uuid' so it actually exercises UUID-shape rejection.
      await expect(
        pinHandlers['/pins'].POST({
          body: { entityType: 'topic', entityId: '' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(pinMock).not.toHaveBeenCalled()
    })

    it('should accept UniqueModelId entityId values for any shared entity type', async () => {
      pinMock.mockResolvedValueOnce({ id: PIN_ID, entityType: 'topic', entityId: MODEL_ID })

      await expect(
        pinHandlers['/pins'].POST({
          body: { entityType: 'topic', entityId: MODEL_ID }
        } as never)
      ).resolves.toMatchObject({ id: PIN_ID, entityType: 'topic', entityId: MODEL_ID })

      expect(pinMock).toHaveBeenCalledWith({ entityType: 'topic', entityId: MODEL_ID })
    })
  })

  describe('/pins/:id', () => {
    it('should delegate GET with the parsed id', async () => {
      getByIdMock.mockResolvedValueOnce({ id: PIN_ID })

      await expect(pinHandlers['/pins/:id'].GET({ params: { id: PIN_ID } } as never)).resolves.toEqual({
        id: PIN_ID
      })
      expect(getByIdMock).toHaveBeenCalledWith(PIN_ID)
    })

    it('should delegate DELETE with the parsed id', async () => {
      unpinMock.mockResolvedValueOnce(undefined)

      await expect(pinHandlers['/pins/:id'].DELETE({ params: { id: PIN_ID } } as never)).resolves.toBeUndefined()
      expect(unpinMock).toHaveBeenCalledWith(PIN_ID)
    })

    it('should reject invalid pin ids in path params before calling the service', async () => {
      await expect(pinHandlers['/pins/:id'].GET({ params: { id: 'not-a-uuid' } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )
      expect(getByIdMock).not.toHaveBeenCalled()

      await expect(pinHandlers['/pins/:id'].DELETE({ params: { id: 'not-a-uuid' } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )
      expect(unpinMock).not.toHaveBeenCalled()
    })
  })

  describe('/pins/:id/order', () => {
    it('should delegate PATCH with the parsed id and anchor', async () => {
      reorderMock.mockResolvedValueOnce(undefined)

      await expect(
        pinHandlers['/pins/:id/order'].PATCH({
          params: { id: PIN_ID },
          body: { before: OTHER_PIN_ID }
        } as never)
      ).resolves.toBeUndefined()

      expect(reorderMock).toHaveBeenCalledWith(PIN_ID, { before: OTHER_PIN_ID })
    })

    it('should reject a malformed anchor before calling the service', async () => {
      await expect(
        pinHandlers['/pins/:id/order'].PATCH({
          params: { id: PIN_ID },
          body: { before: OTHER_PIN_ID, after: OTHER_PIN_ID }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(reorderMock).not.toHaveBeenCalled()
    })

    it('should reject an invalid pin id before calling the service', async () => {
      await expect(
        pinHandlers['/pins/:id/order'].PATCH({
          params: { id: 'not-a-uuid' },
          body: { position: 'first' }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(reorderMock).not.toHaveBeenCalled()
    })
  })

  describe('/pins/order:batch', () => {
    it('should delegate PATCH with the parsed moves array', async () => {
      reorderBatchMock.mockResolvedValueOnce(undefined)

      await expect(
        pinHandlers['/pins/order:batch'].PATCH({
          body: {
            moves: [
              { id: PIN_ID, anchor: { position: 'first' } },
              { id: OTHER_PIN_ID, anchor: { after: PIN_ID } }
            ]
          }
        } as never)
      ).resolves.toBeUndefined()

      expect(reorderBatchMock).toHaveBeenCalledWith([
        { id: PIN_ID, anchor: { position: 'first' } },
        { id: OTHER_PIN_ID, anchor: { after: PIN_ID } }
      ])
    })

    it('should reject an empty moves array before calling the service', async () => {
      await expect(pinHandlers['/pins/order:batch'].PATCH({ body: { moves: [] } } as never)).rejects.toHaveProperty(
        'name',
        'ZodError'
      )
      expect(reorderBatchMock).not.toHaveBeenCalled()
    })

    it('should reject a move missing an anchor before calling the service', async () => {
      await expect(
        pinHandlers['/pins/order:batch'].PATCH({
          body: { moves: [{ id: PIN_ID }] }
        } as never)
      ).rejects.toHaveProperty('name', 'ZodError')
      expect(reorderBatchMock).not.toHaveBeenCalled()
    })
  })
})
