import type { CreateMcpServerDto, UpdateMcpServerDto } from '@shared/data/api/schemas/mcpServers'
import type { McpServer } from '@shared/data/types/mcpServer'

type McpServerDraft = Partial<McpServer> & { url?: string }
type CreateMcpServerDraft = McpServerDraft & Pick<McpServer, 'name'>

const stripReadonlyMcpServerFields = (server: McpServerDraft): UpdateMcpServerDto => {
  const dto = { ...server }
  // Keep this aligned with fields that strict create/update DTO schemas reject.
  delete dto.id
  delete dto.createdAt
  delete dto.updatedAt
  delete dto.url
  return dto
}

export const toCreateMcpServerDto = (server: CreateMcpServerDraft): CreateMcpServerDto => {
  const dto: CreateMcpServerDto = { ...stripReadonlyMcpServerFields(server), name: server.name }

  if (dto.baseUrl === undefined && server.url !== undefined) {
    dto.baseUrl = server.url
  }

  return dto
}

export const toUpdateMcpServerDto = (server: McpServerDraft): UpdateMcpServerDto => {
  return stripReadonlyMcpServerFields(server)
}
