import { desc, eq } from 'drizzle-orm'

import { application } from '@application'
import { notifyDataApiDataChange } from '@data/dataApiDataChange'
import { type ApiGatewayPairedDeviceRow, apiGatewayPairedDeviceTable } from '@data/db/schemas/apiGatewayPairedDevice'
import { defaultHandlersFor, withSqliteErrors } from '@data/db/sqliteErrors'
import type { DbOrTx } from '@data/db/types'
import { loggerService } from '@logger'
import { Emitter } from '@main/core/lifecycle'
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
    createdAt: timestampToISO(row.createdAt),
    updatedAt: timestampToISO(row.updatedAt)
  }
}

export class ApiGatewayPairedDeviceService {
  private readonly _onDeleted = new Emitter<string>()
  readonly onDeleted = this._onDeleted.event

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

  get(id: string, tx: DbOrTx = this.db): ApiGatewayPairedDevice | undefined {
    const row = tx.select().from(apiGatewayPairedDeviceTable).where(eq(apiGatewayPairedDeviceTable.id, id)).get()
    return row ? rowToApiGatewayPairedDevice(row) : undefined
  }

  findByTokenHash(tokenHash: string): ApiGatewayPairedDevice | undefined {
    const row = this.db
      .select()
      .from(apiGatewayPairedDeviceTable)
      .where(eq(apiGatewayPairedDeviceTable.tokenHash, tokenHash))
      .get()
    return row ? rowToApiGatewayPairedDevice(row) : undefined
  }

  create(input: ApiGatewayPairedDeviceMetadata & { tokenHash: string }): ApiGatewayPairedDevice {
    const metadata = ApiGatewayPairedDeviceMetadataSchema.safeParse({ name: input.name, platform: input.platform })
    if (!metadata.success) throw toDataApiError(metadata.error, 'create paired device')

    const [row] = withSqliteErrors(
      () =>
        this.db
          .insert(apiGatewayPairedDeviceTable)
          .values({ ...metadata.data, tokenHash: input.tokenHash })
          .returning()
          .all(),
      defaultHandlersFor('ApiGatewayPairedDevice', metadata.data.name)
    )
    const device = rowToApiGatewayPairedDevice(row)
    notifyDataApiDataChange([{ endpoint: '/api-gateway/paired-devices', kind: 'membership', entityIds: [device.id] }])
    logger.info('Created API Gateway paired device', { id: device.id, platform: device.platform })
    return device
  }

  hasTokenHash(tokenHash: string): boolean {
    return this.findByTokenHash(tokenHash) !== undefined
  }

  delete(id: string): void {
    const [row] = this.db
      .delete(apiGatewayPairedDeviceTable)
      .where(eq(apiGatewayPairedDeviceTable.id, id))
      .returning()
      .all()
    if (!row) throw DataApiErrorFactory.notFound('ApiGatewayPairedDevice', id)

    this._onDeleted.fire(id)
    notifyDataApiDataChange([{ endpoint: '/api-gateway/paired-devices', kind: 'membership', entityIds: [id] }])
    logger.info('Deleted API Gateway paired device', { id })
  }
}

export const apiGatewayPairedDeviceService = new ApiGatewayPairedDeviceService()
