import { loggerService } from '@logger'
import { formatAgentServerError } from '@renderer/utils'
import {
  AddAgentForm,
  AgentServerErrorSchema,
  CreateAgentRequest,
  CreateAgentResponse,
  CreateAgentResponseSchema,
  GetAgentResponse,
  GetAgentResponseSchema,
  type ListAgentsResponse,
  ListAgentsResponseSchema,
  UpdateAgentForm,
  UpdateAgentRequest,
  UpdateAgentResponse,
  UpdateAgentResponseSchema
} from '@types'
import { Axios, AxiosRequestConfig, isAxiosError } from 'axios'

type ApiVersion = 'v1'

const logger = loggerService.withContext('AgentApiClient')

// const logger = loggerService.withContext('AgentClient')
const processError = (error: unknown, fallbackMessage: string) => {
  logger.error(fallbackMessage, error as Error)
  if (isAxiosError(error)) {
    const result = AgentServerErrorSchema.safeParse(error.response)
    if (result.success) {
      return new Error(formatAgentServerError(result.data), { cause: error })
    }
  }
  return new Error(fallbackMessage, { cause: error })
}

export class AgentApiClient {
  private axios: Axios
  private apiVersion: ApiVersion = 'v1'
  constructor(config: AxiosRequestConfig, apiVersion?: ApiVersion) {
    if (!config.baseURL || !config.headers?.Authorization) {
      throw new Error('Please pass in baseUrl and Authroization header.')
    }
    if (config.baseURL.endsWith('/')) {
      throw new Error('baseURL should not end with /')
    }
    this.axios = new Axios(config)
    if (apiVersion) {
      this.apiVersion = apiVersion
    }
  }

  public agentPaths = {
    base: `/${this.apiVersion}/agents`,
    withId: (id: string) => `/${this.apiVersion}/agents/${id}`
  }

  public getSessionPaths = (agentId: string) => ({
    base: `/${this.apiVersion}/agents/${agentId}/sessions`,
    withId: (id: string) => `/${this.apiVersion}/agents/${agentId}/sessions/${id}`
  })

  public getSessionMessagesPath = (agentId: string, sessionId: string) =>
    `/${this.apiVersion}/agents/${agentId}/sessions/${sessionId}/messages`

  public async listAgents(): Promise<ListAgentsResponse> {
    const url = this.agentPaths.base
    try {
      const response = await this.axios.get(url)
      const result = ListAgentsResponseSchema.safeParse(response.data)
      if (!result.success) {
        throw new Error('Not a valid Agents array.')
      }
      return result.data
    } catch (error) {
      throw processError(error, 'Failed to list agents.')
    }
  }

  public async createAgent(agent: AddAgentForm): Promise<CreateAgentResponse> {
    const url = this.agentPaths.base
    try {
      const payload = agent satisfies CreateAgentRequest
      const response = await this.axios.post(url, payload)
      const data = CreateAgentResponseSchema.parse(response.data)
      return data
    } catch (error) {
      throw processError(error, 'Failed to create agent.')
    }
  }

  public async getAgent(id: string): Promise<GetAgentResponse> {
    const url = this.agentPaths.withId(id)
    try {
      const response = await this.axios.get(url)
      const data = GetAgentResponseSchema.parse(response.data)
      return data
    } catch (error) {
      throw processError(error, 'Failed to get agent.')
    }
  }

  public async deleteAgent(id: string): Promise<void> {
    const url = this.agentPaths.withId(id)
    try {
      await this.axios.delete(url)
    } catch (error) {
      throw processError(error, 'Failed to delete agent.')
    }
  }

  public async updateAgent(id: string, agent: UpdateAgentForm): Promise<UpdateAgentResponse> {
    const url = this.agentPaths.withId(id)
    try {
      const payload = agent satisfies UpdateAgentRequest
      const response = await this.axios.patch(url, payload)
      const data = UpdateAgentResponseSchema.parse(response.data)
      return data
    } catch (error) {
      throw processError(error, 'Failed to updateAgent.')
    }
  }
}
