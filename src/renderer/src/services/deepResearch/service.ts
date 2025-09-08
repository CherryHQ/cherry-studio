import { loggerService } from '@logger'
import { fetchChatCompletion } from '@renderer/services/ApiService'
import {
  CLARIFY_WITH_USER_PROMPT,
  COMPRESS_RESEARCH_FINDINGS_PROMPT,
  FINAL_REPORT_PROMPT,
  GENERATE_RESEARCH_BRIEF_INSTRUCTION,
  LEAD_RESEARCH_PROMPT,
  RESEARCHER_PROMPT
} from '@renderer/services/deepResearch/prompt'
import {
  ClarifyWithUserResponse,
  ClarifyWithUserSchema,
  ResearchTopicsResponse,
  ResearchTopicsSchema
} from '@renderer/services/deepResearch/type'
import { formatInfoSources } from '@renderer/services/deepResearch/utils'
import { Assistant, KnowledgeReference, MCPToolResponse, Message, WebSearchResponse } from '@renderer/types'
import type { Chunk } from '@renderer/types/chunk'
import jaison from 'jaison/lib'

const logger = loggerService.withContext('DeepResearchService')

export class DeepResearchService {
  // 判断是否需要澄清
  clarifyQuery = async (messages: Message[], assistant: Assistant): Promise<ClarifyWithUserResponse> => {
    try {
      const prompt = this.buildClarifyingPrompt()

      const result = await fetchChatCompletion({
        messages: messages,
        assistant: {
          ...this.mutedAssistant(assistant),
          prompt: prompt
        },
        onChunkReceived: () => {}
      })

      return ClarifyWithUserSchema.parse(jaison(result?.getText()))
    } catch (error: any) {
      logger.error('Error in clarifyQuery:', error)
      throw error
    }
  }

  // 生成研究简报
  generateBrief = async (messages: Message[], assistant: Assistant) => {
    try {
      logger.info('Generating research brief...')
      const prompt = this.buildGenerateResearchBriefPrompt()
      const result = await fetchChatCompletion({
        messages: messages,
        assistant: {
          ...this.mutedAssistant(assistant),
          prompt: prompt
        },
        onChunkReceived: () => {}
      })
      if (!result) {
        throw new Error('received empty result when generating brief')
      }
      return result?.getText()
    } catch (error: any) {
      logger.error('Error in clarifyQuery:', error)
      throw error
    }
  }

  // 根据简报生成研究主题
  getResearchTopics = async (
    brief: string,
    findings: string[],
    currentIteration: number,
    maxIterations: number,
    maxParallelTasks: number,
    messages: Message[],
    assistant: Assistant
  ): Promise<ResearchTopicsResponse> => {
    try {
      logger.info('Breaking down brief into research topics...')

      const result = await fetchChatCompletion({
        messages: messages,
        assistant: {
          ...assistant,
          enableWebSearch: undefined,
          webSearchProviderId: undefined,
          mcpServers: undefined,
          knowledge_bases: undefined,
          settings: {
            ...assistant.settings,
            reasoning_effort: undefined,
            reasoning_effort_cache: undefined
          },
          prompt: this.buildLeadResearcherPrompt(brief, findings, currentIteration, maxIterations, maxParallelTasks)
        },
        onChunkReceived: () => {}
      })

      if (!result) {
        throw new Error('received empty result when getting research topics')
      }
      return ResearchTopicsSchema.parse(jaison(result.getText()))
    } catch (error: any) {
      logger.error('Error in getResearchTopics:', error)
      throw error
    }
  }

  // 单独运行某个研究主题
  runSingleResearch = async (
    task: string,
    messages: Message[],
    assistant: Assistant,
    callbacks: (chunk: Chunk) => void
  ) => {
    try {
      logger.info(`Running research for task: ${task}`)
      await fetchChatCompletion({
        messages: messages,
        assistant: {
          ...assistant,
          prompt: RESEARCHER_PROMPT(new Date().toISOString(), task)
        },
        onChunkReceived: callbacks
      })
    } catch (error: any) {
      logger.error('Error in runSingleResearch:', error)
      throw error
    }
  }

  compressResearchResult = async (
    task: string,
    rawResult: string,
    infoSources: (WebSearchResponse | KnowledgeReference | MCPToolResponse)[],
    messages: Message[],
    assistant: Assistant
  ) => {
    try {
      const prompt = this.buildCompressResearchResultPrompt(task, rawResult, infoSources)
      const result = await fetchChatCompletion({
        messages: messages,
        assistant: {
          ...this.mutedAssistant(assistant),
          prompt: prompt
        },
        onChunkReceived: () => {}
      })
      return { compressedResult: result?.getText() }
    } catch (error: any) {
      logger.error('Error in compressResearchResult:', error)
      throw error
    }
  }

  generateFinalReport = async (
    brief: string,
    compressedReports: string[],
    messages: Message[],
    assistant: Assistant,
    callbacks: (chunk: Chunk) => void
  ) => {
    try {
      const prompt = this.buildFinalReportPrompt(brief, compressedReports)
      await fetchChatCompletion({
        messages: messages,
        assistant: {
          ...assistant,
          prompt: prompt,
          enableWebSearch: undefined,
          webSearchProviderId: undefined,
          mcpServers: undefined,
          knowledge_bases: undefined
        },
        onChunkReceived: callbacks
      })
    } catch (error: any) {
      logger.error('Error in generateFinalReport:', error)
      throw error
    }
  }

  buildClarifyingPrompt = (): string => {
    return CLARIFY_WITH_USER_PROMPT(new Date().toISOString())
  }

  buildGenerateResearchBriefPrompt = (): string => {
    return GENERATE_RESEARCH_BRIEF_INSTRUCTION(new Date().toISOString())
  }

  buildLeadResearcherPrompt = (
    brief: string,
    findings: string[],
    currentIteration: number,
    maxIterations: number,
    maxParallelTasks: number
  ): string => {
    return LEAD_RESEARCH_PROMPT(
      new Date().toISOString(),
      brief,
      findings,
      currentIteration,
      maxIterations,
      maxParallelTasks
    )
  }

  buildFindings(rawResult: string, infoSources: (WebSearchResponse | KnowledgeReference | MCPToolResponse)[]) {
    return `--- Raw Result ---\n${rawResult}\n--- End Raw Result ---\n--- Info Sources ---\n${formatInfoSources(rawResult, infoSources)}\n --- End Info Sources ---`
  }

  buildCompressResearchResultPrompt = (
    task: string,
    rawResult: string,
    infoSources: (WebSearchResponse | KnowledgeReference | MCPToolResponse)[]
  ): string => {
    const findings = this.buildFindings(rawResult, infoSources)
    return COMPRESS_RESEARCH_FINDINGS_PROMPT(new Date().toISOString(), task, findings)
  }

  buildFinalReportPrompt = (brief: string, compressedReports: string[]): string => {
    const findingsText = compressedReports
      .map((r, i) => `=== Finding ${i + 1} ===\n${r}\n=== End Finding ${i + 1}`)
      .join('\n\n')
    return FINAL_REPORT_PROMPT(brief, findingsText, new Date().toISOString())
  }

  // 禁用思考，搜索和工具
  private mutedAssistant = (assistant: Assistant): Assistant => {
    return {
      ...assistant,
      enableWebSearch: undefined,
      webSearchProviderId: undefined,
      mcpServers: undefined,
      knowledge_bases: undefined,
      settings: {
        ...assistant.settings,
        reasoning_effort: undefined,
        reasoning_effort_cache: undefined
      }
    }
  }
}
