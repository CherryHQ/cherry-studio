import { randomUUID } from 'node:crypto'

import { and, desc, eq } from 'drizzle-orm'

import { application } from '@application'
import {
  remoteCapabilitiesSchema,
  type RemoteAuthorization,
  type RemoteCapability
} from '@cherrystudio/remote-protocol'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { type ApiGatewayPairedDeviceRow, apiGatewayPairedDeviceTable } from '@data/db/schemas/apiGatewayPairedDevice'
import { loggerService } from '@logger'
import { DataApiErrorFactory, toDataApiError } from '@shared/data/api/errors'
import {
  type ApiGatewayPairedDevice,
  type ApiGatewayPairedDeviceMetadata,
  ApiGatewayPairedDeviceMetadataSchema
} from '@shared/data/types/apiGatewayPairedDevice'

import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:ApiGatewayPairedDeviceService')

function rowToApiGatewayPairedDevice(row: ApiGatewayPairedDeviceRow): ApiGatewayPairedDevice {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    ...(row.peerIdentity
      ? { remoteAccess: { capabilities: authorizationFor(row).grants.map((grant) => grant.domain) } }
      : {}),
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

function authorizationFor(row: ApiGatewayPairedDeviceRow): RemoteAuthorization {
  const grants: RemoteAuthorization['grants'] = []
  if (row.configurationGrantId) grants.push({ domain: 'configuration', grantId: row.configurationGrantId })
  if (row.agentGrantId) grants.push({ domain: 'agent', grantId: row.agentGrantId })
  return { grants }
}

export class ApiGatewayPairedDeviceService {
  private get db() {
    return application.get('DbService').getDb()
  }

  list(): ApiGatewayPairedDevice[] {
    return this.db
      .select()
      .from(apiGatewayPairedDeviceTable)
      .orderBy(desc(apiGatewayPairedDeviceTable.createdAt))
      .all()
      .map(rowToApiGatewayPairedDevice)
  }

  approveRemote(input: ApiGatewayPairedDeviceMetadata & { peerIdentity: string; capabilities: RemoteCapability[] }): {
    device: ApiGatewayPairedDevice
    authorization: RemoteAuthorization
  } {
    const parsed = ApiGatewayPairedDeviceMetadataSchema.safeParse({ name: input.name, platform: input.platform })
    if (!parsed.success) throw toDataApiError(parsed.error, 'approve paired device')
    const metadata = parsed.data
    const capabilities = remoteCapabilitiesSchema.parse(input.capabilities)
    if (!input.peerIdentity || input.peerIdentity.length > 256)
      throw DataApiErrorFactory.invalidOperation('Invalid device identity')
    const row = application.get('DbService').withWriteTx((tx) => {
      const existing = tx
        .select()
        .from(apiGatewayPairedDeviceTable)
        .where(eq(apiGatewayPairedDeviceTable.peerIdentity, input.peerIdentity))
        .get()
      const values = {
        ...metadata,
        peerIdentity: input.peerIdentity,
        configurationGrantId: capabilities.includes('configuration') ? randomUUID() : null,
        agentGrantId: capabilities.includes('agent') ? randomUUID() : null
      }
      return existing
        ? tx
            .update(apiGatewayPairedDeviceTable)
            .set(values)
            .where(eq(apiGatewayPairedDeviceTable.id, existing.id))
            .returning()
            .get()
        : tx.insert(apiGatewayPairedDeviceTable).values(values).returning().get()
    })
    const device = rowToApiGatewayPairedDevice(row)
    notifyDataApiDataChange([{ endpoint: '/api-gateway/paired-devices', kind: 'membership', entityIds: [device.id] }])
    return { device, authorization: authorizationFor(row) }
  }

  getRemoteAuthorization(deviceId: string, peerIdentity: string): RemoteAuthorization | undefined {
    const row = this.db
      .select()
      .from(apiGatewayPairedDeviceTable)
      .where(
        and(eq(apiGatewayPairedDeviceTable.id, deviceId), eq(apiGatewayPairedDeviceTable.peerIdentity, peerIdentity))
      )
      .get()
    if (!row) return undefined
    const authorization = authorizationFor(row)
    return authorization.grants.length ? authorization : undefined
  }

  revokeRemoteCapability(deviceId: string, capability: RemoteCapability): void {
    const values = capability === 'agent' ? { agentGrantId: null } : { configurationGrantId: null }
    const row = this.db
      .update(apiGatewayPairedDeviceTable)
      .set(values)
      .where(eq(apiGatewayPairedDeviceTable.id, deviceId))
      .returning()
      .get()
    if (!row) throw DataApiErrorFactory.notFound('ApiGatewayPairedDevice', deviceId)
    notifyDataApiDataChange([{ endpoint: '/api-gateway/paired-devices', kind: 'membership', entityIds: [deviceId] }])
  }

  delete(id: string): void {
    const [row] = this.db
      .delete(apiGatewayPairedDeviceTable)
      .where(eq(apiGatewayPairedDeviceTable.id, id))
      .returning()
      .all()
    if (!row) throw DataApiErrorFactory.notFound('ApiGatewayPairedDevice', id)

    notifyDataApiDataChange([{ endpoint: '/api-gateway/paired-devices', kind: 'membership', entityIds: [id] }])
    logger.info('Deleted API Gateway paired device', { id })
  }
}

export const apiGatewayPairedDeviceService = new ApiGatewayPairedDeviceService()
