import { loggerService } from '@logger'
import { formatAgentServerError } from '@renderer/utils/error'
import type {
  AddAgentForm,
  ApiModelsFilter,
  ApiModelsResponse,
  CreateAgentRequest,
  CreateAgentResponse,
  CreateSessionForm,
  CreateSessionRequest,
  GetAgentResponse,
  GetAgentSessionResponse,
  ListAgentSessionsResponse,
  ListAgentsResponse,
  UpdateAgentForm,
  UpdateAgentRequest,
  UpdateAgentResponse,
  UpdateSessionForm,
  UpdateSessionRequest
} from '@types'
import {
  AgentServerErrorSchema,
  ApiModelsResponseSchema,
  CreateAgentResponseSchema,
  GetAgentResponseSchema,
  GetAgentSessionResponseSchema,
  ListAgentSessionsResponseSchema,
  ListAgentsResponseSchema,
  objectEntries,
  objectKeys,
  UpdateAgentResponseSchema
} from '@types'
import type { Axios, AxiosRequestConfig } from 'axios'
import axios, { isAxiosError } from 'axios'
import { ZodError } from 'zod'

type ApiVersion = 'v1'

const logger = loggerService.withContext('AgentApiClient')

// const logger = loggerService.withContext('AgentClient')
const processError = (error: unknown, fallbackMessage: string) => {
  logger.error(fallbackMessage, error as Error)
  if (isAxiosError(error)) {
    const result = AgentServerErrorSchema.safeParse(error.response?.data)
    if (result.success) {
      return new Error(formatAgentServerError(result.data))
    }
  } else if (error instanceof ZodError) {
    return error
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
    this.axios = axios.create(config)
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

  public getSessionMessagesPaths = (agentId: string, sessionId: string) => ({
    base: `/${this.apiVersion}/agents/${agentId}/sessions/${sessionId}/messages`,
    withId: (id: number) => `/${this.apiVersion}/agents/${agentId}/sessions/${sessionId}/messages/${id}`
  })

  public getModelsPath = (props?: ApiModelsFilter) => {
    const base = `/${this.apiVersion}/models`
    if (!props) return base
    if (objectKeys(props).length > 0) {
      const params = objectEntries(props)
        .map(([key, value]) => `${key}=${value}`)
        .join('&')
      return `${base}?${params}`
    } else {
      return base
    }
  }

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

  public async createAgent(form: AddAgentForm): Promise<CreateAgentResponse> {
    const url = this.agentPaths.base
    try {
      const payload = form satisfies CreateAgentRequest
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
      if (data.id !== id) {
        throw new Error('Agent ID mismatch in response')
      }
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

  public async updateAgent(form: UpdateAgentForm): Promise<UpdateAgentResponse> {
    const url = this.agentPaths.withId(form.id)
    try {
      const payload = form satisfies UpdateAgentRequest
      const response = await this.axios.patch(url, payload)
      const data = UpdateAgentResponseSchema.parse(response.data)
      if (data.id !== form.id) {
        throw new Error('Agent ID mismatch in response')
      }
      return data
    } catch (error) {
      throw processError(error, 'Failed to updateAgent.')
    }
  }

  public async listSessions(agentId: string): Promise<ListAgentSessionsResponse> {
    const url = this.getSessionPaths(agentId).base
    try {
      const response = await this.axios.get(url)
      const result = ListAgentSessionsResponseSchema.safeParse(response.data)
      if (!result.success) {
        throw new Error('Not a valid Sessions array.')
      }
      return result.data
    } catch (error) {
      throw processError(error, 'Failed to list sessions.')
    }
  }

  public async createSession(agentId: string, session: CreateSessionForm): Promise<GetAgentSessionResponse> {
    const url = this.getSessionPaths(agentId).base
    try {
      const payload = session satisfies CreateSessionRequest
      const response = await this.axios.post(url, payload)
      const data = GetAgentSessionResponseSchema.parse(response.data)
      return data
    } catch (error) {
      throw processError(error, 'Failed to add session.')
    }
  }

  public async getSession(agentId: string, sessionId: string): Promise<GetAgentSessionResponse> {
    const url = this.getSessionPaths(agentId).withId(sessionId)
    try {
      const response = await this.axios.get(url)
      // const data = GetAgentSessionResponseSchema.parse(response.data)
      // TODO: enable validation
      const data = response.data
      if (sessionId !== data.id) {
        throw new Error('Session ID mismatch in response')
      }
      return data
    } catch (error) {
      throw processError(error, 'Failed to get session.')
    }
  }

  public async deleteSession(agentId: string, sessionId: string): Promise<void> {
    const url = this.getSessionPaths(agentId).withId(sessionId)
    try {
      await this.axios.delete(url)
    } catch (error) {
      throw processError(error, 'Failed to delete session.')
    }
  }

  public async deleteSessionMessage(agentId: string, sessionId: string, messageId: number): Promise<void> {
    const url = this.getSessionMessagesPaths(agentId, sessionId).withId(messageId)
    try {
      await this.axios.delete(url)
    } catch (error) {
      throw processError(error, 'Failed to delete session message.')
    }
  }

  public async updateSession(agentId: string, session: UpdateSessionForm): Promise<GetAgentSessionResponse> {
    const url = this.getSessionPaths(agentId).withId(session.id)
    try {
      const payload = session satisfies UpdateSessionRequest
      const response = await this.axios.patch(url, payload)
      const data = GetAgentSessionResponseSchema.parse(response.data)
      if (session.id !== data.id) {
        throw new Error('Session ID mismatch in response')
      }
      return data
    } catch (error) {
      throw processError(error, 'Failed to update session.')
    }
  }

  public async getModels(props?: ApiModelsFilter): Promise<ApiModelsResponse> {
    const url = this.getModelsPath(props)
    try {
      const response = await this.axios.get(url)
      const data = ApiModelsResponseSchema.parse(response.data)
      return data
    } catch (error) {
      throw processError(error, 'Failed to get models.')
    }
  }
}
