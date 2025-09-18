import { ListAgentsResponseSchema, type ListAgentsResponse } from '@types'
import { Axios, AxiosRequestConfig } from 'axios'

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
}
