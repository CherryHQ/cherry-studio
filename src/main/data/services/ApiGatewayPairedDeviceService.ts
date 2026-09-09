import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { type ApiGatewayPairedDeviceRow, apiGatewayPairedDeviceTable } from '@data/db/schemas/apiGatewayPairedDevice'
import { loggerService } from '@logger'
import { DataApiErrorFactory, toDataApiError } from '@shared/data/api/errors'
import {
  type ApiGatewayPairedDevice,
  type ApiGatewayPairedDeviceMetadata,
  ApiGatewayPairedDeviceMetadataSchema
} from '@shared/data/types/apiGatewayPairedDevice'
import { desc, eq } from 'drizzle-orm'

import { timestampToISO } from './utils/rowMappers'

const logger = loggerService.withContext('DataApi:ApiGatewayPairedDeviceService')

function rowToApiGatewayPairedDevice(row: ApiGatewayPairedDeviceRow): ApiGatewayPairedDevice {
  return {
    id: row.id,
    name: row.name,
    platform: row.platform,
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
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

  create(input: ApiGatewayPairedDeviceMetadata & { tokenHash: string }): ApiGatewayPairedDevice {
    const metadata = ApiGatewayPairedDeviceMetadataSchema.safeParse({ name: input.name, platform: input.platform })
    if (!metadata.success) throw toDataApiError(metadata.error, 'create paired device')

    const [row] = this.db
      .insert(apiGatewayPairedDeviceTable)
      .values({ ...metadata.data, tokenHash: input.tokenHash })
      .returning()
      .all()
    const device = rowToApiGatewayPairedDevice(row)
    notifyDataApiDataChange([{ endpoint: '/api-gateway/paired-devices', kind: 'membership', entityIds: [device.id] }])
    logger.info('Created API Gateway paired device', { id: device.id, platform: device.platform })
    return device
  }

  hasTokenHash(tokenHash: string): boolean {
    return Boolean(
      this.db
        .select({ id: apiGatewayPairedDeviceTable.id })
        .from(apiGatewayPairedDeviceTable)
        .where(eq(apiGatewayPairedDeviceTable.tokenHash, tokenHash))
        .limit(1)
        .get()
    )
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
