import { formatAgentServerError } from '@renderer/utils'
import {
  AgentForm,
  AgentServerErrorSchema,
  CreateAgentRequest,
  CreateAgentResponse,
  CreateAgentResponseSchema,
  GetAgentResponse,
  GetAgentResponseSchema,
  type ListAgentsResponse,
  ListAgentsResponseSchema
} from '@types'
import { Axios, AxiosRequestConfig, isAxiosError } from 'axios'

type ApiVersion = 'v1'

// const logger = loggerService.withContext('AgentClient')

export class AgentClient {
  private axios: Axios
  private apiVersion: ApiVersion = 'v1'
  constructor(config: AxiosRequestConfig, apiVersion?: ApiVersion) {
    if (!config.baseURL || !config.headers?.Authorization) {
      throw new Error('Please pass in baseUrl and Authroization header.')
    }
    this.axios = new Axios(config)
    if (apiVersion) {
      this.apiVersion = apiVersion
    }
  }

  public async listAgents(): Promise<ListAgentsResponse> {
    const url = `/${this.apiVersion}/agents`
    try {
      const response = await this.axios.get(url)
      const result = ListAgentsResponseSchema.safeParse(response.data)
      if (!result.success) {
        throw new Error('Not a valid Agents array.')
      }
      return result.data
    } catch (error) {
      throw new Error('Failed to list agents.', { cause: error })
    }
  }

  public async createAgent(agent: AgentForm): Promise<CreateAgentResponse> {
    const url = `/${this.apiVersion}/agents`
    try {
      const payload = {
        ...agent
      } satisfies CreateAgentRequest
      const response = await this.axios.post(url, payload)
      const data = CreateAgentResponseSchema.parse(response.data)
      return data
    } catch (error) {
      throw new Error('Failed to create agent.', { cause: error })
    }
  }

  public async getAgent(id: string): Promise<GetAgentResponse> {
    const url = `/${this.apiVersion}/agents/${id}`
    try {
      const response = await this.axios.get(url)
      const data = GetAgentResponseSchema.parse(response.data)
      return data
    } catch (error) {
      throw new Error('Failed to get agent.', { cause: error })
    }
  }

  public async deleteAgent(id: string): Promise<void> {
    const url = `/${this.apiVersion}/agents/${id}`
    try {
      await this.axios.delete(url)
    } catch (error) {
      if (isAxiosError(error)) {
        const result = AgentServerErrorSchema.safeParse(error.response)
        if (result.success) {
          throw new Error(formatAgentServerError(result.data), { cause: error })
        }
      }
      throw new Error('Failed to delete agent.', { cause: error })
    }
  }
}
