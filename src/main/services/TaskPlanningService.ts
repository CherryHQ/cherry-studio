/**
 * Task Planning Service
 * Uses AI to intelligently plan task execution order for multiple targets
 */

import type {
  ExecutionStep,
  ParallelExecutionGroup,
  PlanningMetadata,
  PlanningResult,
  TaskDependency,
  TaskExecutionPlan,
  TaskTarget
} from '@types'
import * as z from 'zod'

import { getAvailableProviders } from '../apiServer/utils'
import { loggerService } from './LoggerService'

const logger = loggerService.withContext('TaskPlanningService')

/**
 * Schema for AI-generated execution plan
 * This ensures structured output from the LLM
 */
const ExecutionPlanSchema = z.object({
  summary: z.string().describe('Human-readable summary of the execution plan'),
  reasoning: z.string().describe('Explanation of planning decisions'),
  confidence: z.number().min(0).max(1).describe('Confidence score (0-1)'),
  estimatedDuration: z.number().describe('Estimated total duration in seconds'),
  parallelGroups: z
    .array(
      z.object({
        targets: z.array(z.number()).describe('Indices of targets that can run in parallel'),
        description: z.string().describe('Description of why these can run in parallel'),
        estimatedDuration: z.number().optional().describe('Estimated duration for this group'),
        reason: z.string().describe('Why these targets can be parallelized')
      })
    )
    .describe('Groups of targets that can execute in parallel'),
  sequentialSteps: z
    .array(
      z.object({
        targetIndex: z.number().describe('Index of the target in the original list'),
        order: z.number().describe('Execution order (1-based)'),
        reason: z.string().describe('Why this target should be executed at this step'),
        estimatedDuration: z.number().optional().describe('Estimated duration in seconds')
      })
    )
    .describe('Sequential execution steps for targets with dependencies'),
  dependencies: z
    .array(
      z.object({
        from: z.number().describe('Index of source target'),
        to: z.number().describe('Index of dependent target'),
        reason: z.string().describe('Why this dependency exists'),
        type: z.enum(['sequential', 'parallel', 'conditional'])
      })
    )
    .describe('Dependencies between targets')
})

class TaskPlanningService {
  private static instance: TaskPlanningService | null = null

  private constructor() {
    logger.info('TaskPlanningService initialized')
  }

  public static getInstance(): TaskPlanningService {
    if (!TaskPlanningService.instance) {
      TaskPlanningService.instance = new TaskPlanningService()
    }
    return TaskPlanningService.instance
  }

  /**
   * Generate an intelligent execution plan for the given task
   * @param taskName - Name of the task
   * @param taskDescription - Optional description of the task
   * @param targets - List of targets to execute
   * @param message - Message to send to each target
   * @param planModelId - Model ID to use for planning (e.g., 'anthropic:claude-3-5-sonnet-20241022'). Required for AI planning.
   * @param appLanguage - Application language code (e.g., 'zh-cn', 'en-us'). Used for prompt localization.
   * @returns Planning result with execution plan
   */
  async generateExecutionPlan(
    taskName: string,
    taskDescription: string | undefined,
    targets: Array<{ type: string; id: string; name: string }>,
    message: string,
    planModelId?: string,
    appLanguage?: string
  ): Promise<PlanningResult> {
    const startTime = Date.now()

    try {
      console.log(`[TaskPlanningService] generateExecutionPlan called for task: ${taskName}`)
      logger.info(`[generateExecutionPlan] Starting for task "${taskName}" with ${targets.length} targets`)

      if (targets.length <= 1) {
        // Single target, no planning needed
        console.log(`[TaskPlanningService] Single target detected, skipping planning`)
        const singleTarget = targets[0] as TaskTarget
        return {
          success: true,
          plan: {
            steps: [{ target: singleTarget, order: 1, reason: 'Single target, no planning needed' }],
            parallelGroups: [],
            summary: 'Single target execution'
          },
          duration: Date.now() - startTime
        }
      }

      logger.info(`Generating execution plan for task "${taskName}" with ${targets.length} targets`)

      // Validate and get the model to use for planning
      console.log(`[TaskPlanningService] Validating planning model...`)
      const modelValidation = await this.validatePlanningModel(planModelId)

      if (!modelValidation.valid) {
        console.error(`[TaskPlanningService] Model validation failed:`, modelValidation.error)
        logger.error(`Planning model validation failed`, { error: modelValidation.error })

        return {
          success: false,
          error: modelValidation.error || 'Planning model validation failed',
          duration: Date.now() - startTime
        }
      }

      const modelToUse = modelValidation.modelId!
      console.log(`[TaskPlanningService] Planning model validated: ${modelToUse}`)

      // Create planning prompt
      console.log(`[TaskPlanningService] Creating planning prompt...`)
      const isChinese = appLanguage?.startsWith('zh')
      const prompt = this.createPlanningPrompt(taskName, taskDescription, targets, message, isChinese)
      console.log(`[TaskPlanningService] Prompt created, length: ${prompt.length}`)

      // Call LLM to generate plan
      console.log(`[TaskPlanningService] Calling planning model...`)
      const planResult = await this.callPlanningModel(modelToUse, prompt)
      console.log(`[TaskPlanningService] Planning model returned:`, planResult ? 'success' : 'null')

      if (!planResult) {
        throw new Error('Failed to generate plan from AI model')
      }

      // Convert AI result to execution plan
      console.log(`[TaskPlanningService] Converting to execution plan...`)
      const executionPlan = this.convertToExecutionPlan(planResult, targets, modelToUse)
      console.log(`[TaskPlanningService] Execution plan converted`)

      logger.info(`Execution plan generated successfully in ${Date.now() - startTime}ms`, {
        confidence: executionPlan.planningMetadata?.confidence,
        stepsCount: executionPlan.steps.length,
        parallelGroupsCount: executionPlan.parallelGroups.length
      })

      return {
        success: true,
        plan: executionPlan,
        duration: Date.now() - startTime
      }
    } catch (error) {
      console.error(`[TaskPlanningService] Error in generateExecutionPlan:`, error)
      logger.error('Failed to generate execution plan', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      }
    }
  }

  /**
   * Validate the planning model configuration
   * Returns an object with valid flag and error message if invalid
   */
  private async validatePlanningModel(planModelId?: string): Promise<{
    valid: boolean
    modelId?: string
    error?: string
  }> {
    console.log(`[TaskPlanningService] validatePlanningModel called, planModelId: ${planModelId}`)

    // If no model is specified, return error
    if (!planModelId) {
      const errorMsg = '智能规划需要配置模型。请在任务配置中选择一个用于规划的模型。'
      console.error(`[TaskPlanningService] No planning model specified`)
      logger.error(`No planning model configured for task`)
      return {
        valid: false,
        error: errorMsg
      }
    }

    // Validate model format (must contain ':')
    if (!planModelId.includes(':')) {
      const errorMsg = `无效的模型格式: "${planModelId}"。模型格式应为 "provider:model_id"，例如 "anthropic:claude-3-5-sonnet-20241022"`
      console.error(`[TaskPlanningService] Invalid model format: ${planModelId}`)
      logger.error(`Invalid planning model format`, { modelId: planModelId })
      return {
        valid: false,
        error: errorMsg
      }
    }

    // Validate provider exists and is enabled
    const providers = await getAvailableProviders()
    console.log(`[TaskPlanningService] Available providers: ${providers.map((p) => p.id).join(', ')}`)

    const [providerId, ...modelParts] = planModelId.split(':')
    const actualModelId = modelParts.join(':')

    const provider = providers.find((p) => p.id === providerId)
    if (!provider) {
      const errorMsg = `找不到或未启用提供商 "${providerId}"。请确保该提供商已启用。`
      console.error(`[TaskPlanningService] Provider not found or not enabled: ${providerId}`)
      logger.error(`Planning model provider not found or not enabled`, { providerId })
      return {
        valid: false,
        error: errorMsg
      }
    }

    // Validate model exists in provider
    const modelExists = provider.models?.some((m) => m.id === actualModelId)
    if (!modelExists) {
      const availableModels = provider.models?.map((m) => m.id).join(', ') || 'none'
      const errorMsg = `提供商 "${providerId}" 中没有找到模型 "${actualModelId}"。可用模型: ${availableModels}`
      console.error(`[TaskPlanningService] Model not found in provider: ${actualModelId}`)
      logger.error(`Planning model not found in provider`, { providerId, modelId: actualModelId, availableModels })
      return {
        valid: false,
        error: errorMsg
      }
    }

    console.log(`[TaskPlanningService] Model validation successful: ${planModelId}`)
    logger.info(`Planning model validated successfully`, { modelId: planModelId })
    return {
      valid: true,
      modelId: planModelId
    }
  }

  /**
   * Create the planning prompt for the LLM
   * @param isChinese - Whether to use Chinese prompt (true) or English (false)
   */
  private createPlanningPrompt(
    taskName: string,
    taskDescription: string | undefined,
    targets: Array<{ type: string; id: string; name: string }>,
    message: string,
    isChinese: boolean = false
  ): string {
    const targetsList = targets.map((t, i) => `${i + 1}. ${t.name} (Type: ${t.type}, ID: ${t.id})`).join('\n')

    if (isChinese) {
      return `你是一个 AI 任务规划助手。你的工作是分析一个包含多个目标的任务，并创建最优的执行计划。

# 任务信息
**任务名称：** ${taskName}
${taskDescription ? `**任务描述：** ${taskDescription}` : ''}

# 需要执行的目标
${targetsList}

# 发送消息
${message}

# 你的任务
分析这些目标并创建一个执行计划：
1. 识别哪些目标可以并行执行（它们不依赖彼此的结果）
2. 确定顺序执行的最佳顺序
3. 识别目标之间的依赖关系
4. 估算每个步骤/组的持续时间

# 规划指南
- **助手（Assistants）** 通常可以并行执行（它们生成独立的响应）
- **智能体（Agents）** 应该顺序执行（它们可能有复杂的状态/依赖关系）
- **智能体会话（Agent Sessions）** 必须顺序执行（它们维护对话上下文）
- 根据消息内容确定依赖关系
- 对并行化要保守一些 - 安全总比产生冲突要好

# 输出格式
返回一个 JSON 对象，包含以下结构：
{
  "summary": "计划摘要",
  "reasoning": "规划决策的解释",
  "confidence": 0.85,  // 你对这个计划的信心 (0-1)
  "estimatedDuration": 300,  // 总预估时长（秒）
  "parallelGroups": [
    {
      "targets": [0, 1],  // 可以并行执行的目标索引
      "description": "为什么这些可以并行执行",
      "estimatedDuration": 60,
      "reason": "两者都是助手，生成独立的响应"
    }
  ],
  "sequentialSteps": [
    {
      "targetIndex": 2,  // 目标的索引
      "order": 1,  // 执行顺序
      "reason": "此智能体应该在并行组之后运行",
      "estimatedDuration": 120
    }
  ],
  "dependencies": [
    {
      "from": 0,
      "to": 2,
      "reason": "智能体 2 需要助手 0 的信息",
      "type": "sequential"
    }
  ]
}

重要：目标引用使用从 0 开始的索引（第一个目标索引为 0）。`
    }

    // English prompt (default)
    return `You are an AI task planning assistant. Your job is to analyze a task with multiple targets and create an optimal execution plan.

# Task Information
**Task Name:** ${taskName}
${taskDescription ? `**Description:** ${taskDescription}` : ''}

# Targets to Execute
${targetsList}

# Message to Send
${message}

# Your Task
Analyze the targets and create an execution plan that:
1. Identifies which targets can run in parallel (they don't depend on each other's results)
2. Determines the optimal order for sequential execution
3. Identifies dependencies between targets
4. Estimates the duration for each step/group

# Planning Guidelines
- **Assistants** can typically run in parallel (they generate independent responses)
- **Agents** should generally run sequentially (they may have complex state/dependencies)
- **Agent Sessions** must run sequentially (they maintain conversation context)
- Consider the message content when determining dependencies
- Be conservative with parallelization - it's better to be safe than to have conflicts

# Output Format
Return a JSON object with the following structure:
{
  "summary": "Brief summary of the plan",
  "reasoning": "Explanation of your planning decisions",
  "confidence": 0.85,  // Your confidence in this plan (0-1)
  "estimatedDuration": 300,  // Total estimated duration in seconds
  "parallelGroups": [
    {
      "targets": [0, 1],  // Indices of targets that can run in parallel
      "description": "Why these can run in parallel",
      "estimatedDuration": 60,
      "reason": "Both are assistants generating independent responses"
    }
  ],
  "sequentialSteps": [
    {
      "targetIndex": 2,  // Index of the target
      "order": 1,  // Execution order
      "reason": "This agent should run after the parallel group",
      "estimatedDuration": 120
    }
  ],
  "dependencies": [
    {
      "from": 0,
      "to": 2,
      "reason": "Agent 2 needs information from Assistant 0",
      "type": "sequential"
    }
  ]
}

Important: Use 0-based indices for target references (first target is index 0).`
  }

  /**
   * Call the planning model to generate a plan
   */
  private async callPlanningModel(
    modelId: string,
    prompt: string
  ): Promise<z.infer<typeof ExecutionPlanSchema> | null> {
    try {
      console.log(`[TaskPlanningService] callPlanningModel called with model: ${modelId}`)
      logger.info(`[callPlanningModel] Starting AI call with model: ${modelId}`)

      const [providerId, ...modelParts] = modelId.split(':')
      const actualModelId = modelParts.join(':')

      console.log(`[TaskPlanningService] Provider: ${providerId}, Model: ${actualModelId}`)

      // Get provider information
      const providers = await getAvailableProviders()
      const provider = providers.find((p) => p.id === providerId)

      if (!provider) {
        console.error(`[TaskPlanningService] Provider not found: ${providerId}`)
        throw new Error(`Provider not found: ${providerId}`)
      }

      console.log(`[TaskPlanningService] Provider type: ${provider.type}`)
      console.log(`[TaskPlanningService] Getting API key for provider: ${providerId}`)
      const apiKey = provider.apiKey
      console.log(`[TaskPlanningService] API key length: ${apiKey?.length || 0}`)

      if (!apiKey) {
        console.error(`[TaskPlanningService] No API key found for provider: ${providerId}`)
        throw new Error(`No API key configured for provider: ${providerId}`)
      }

      // Use native fetch for OpenAI-compatible APIs to ensure correct endpoint
      console.log(`[TaskPlanningService] Using native fetch for API call`)

      // Build base URL from provider's apiHost
      let baseUrl = provider.apiHost || 'https://api.openai.com/v1'
      if (!baseUrl.endsWith('/v1')) {
        baseUrl = baseUrl.endsWith('/') ? baseUrl + 'v1' : baseUrl + '/v1'
      }
      const apiUrl = `${baseUrl}/chat/completions`
      console.log(`[TaskPlanningService] API URL: ${apiUrl}`)

      // Prepare request body
      const requestBody = {
        model: actualModelId,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3
      }

      console.log(`[TaskPlanningService] Sending request to ${apiUrl}`)

      // Make the API call
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify(requestBody)
      })

      console.log(`[TaskPlanningService] Response status: ${response.status}`)

      if (!response.ok) {
        const errorText = await response.text()
        console.error(`[TaskPlanningService] API error:`, response.status, errorText)
        throw new Error(`API call failed: ${response.status} ${errorText}`)
      }

      const data = await response.json()
      console.log(`[TaskPlanningService] Response received, parsing...`)

      // Extract the response text
      const responseText = data.choices?.[0]?.message?.content || ''

      if (!responseText) {
        console.error(`[TaskPlanningService] Empty response from API`)
        throw new Error('Empty response from API')
      }

      console.log(`[TaskPlanningService] Response text length: ${responseText.length}`)

      // Parse the JSON response
      const parsedPlan = this.parsePlanningResponse(responseText)

      if (!parsedPlan) {
        throw new Error('Failed to parse planning response from AI')
      }

      return parsedPlan
    } catch (error) {
      console.error(`[TaskPlanningService] Error in callPlanningModel:`, error)
      logger.error('Error calling planning model', error as Error)
      return null
    }
  }

  /**
   * Convert AI-generated plan to execution plan
   */
  private convertToExecutionPlan(
    aiPlan: z.infer<typeof ExecutionPlanSchema>,
    targets: Array<{ type: string; id: string; name: string }>,
    modelUsed: string
  ): TaskExecutionPlan {
    // Helper to create a simple TaskTarget object (avoid circular references)
    const toTaskTarget = (obj: { type: string; id: string; name: string }): TaskTarget => {
      // Validate type is one of the allowed values
      if (obj.type !== 'agent' && obj.type !== 'assistant' && obj.type !== 'agent_session') {
        // Default to 'assistant' if invalid type
        return { type: 'assistant' as const, id: obj.id, name: obj.name }
      }
      // Create a new simple object instead of casting the original
      return { type: obj.type as 'agent' | 'assistant' | 'agent_session', id: obj.id, name: obj.name }
    }

    // Convert parallel groups
    const parallelGroups: ParallelExecutionGroup[] = aiPlan.parallelGroups.map((group) => ({
      targets: group.targets.map((idx) => toTaskTarget(targets[idx])),
      description: group.description,
      estimatedDuration: group.estimatedDuration,
      reason: group.reason
    }))

    // Convert sequential steps
    const steps: ExecutionStep[] = aiPlan.sequentialSteps.map((step) => ({
      target: toTaskTarget(targets[step.targetIndex]),
      order: step.order,
      reason: step.reason,
      estimatedDuration: step.estimatedDuration
    }))

    // Convert dependencies
    const dependencies: TaskDependency[] = aiPlan.dependencies.map((dep) => ({
      from: toTaskTarget(targets[dep.from]),
      to: toTaskTarget(targets[dep.to]),
      reason: dep.reason,
      type: dep.type
    }))

    // Create planning metadata
    const planningMetadata: PlanningMetadata = {
      modelUsed,
      planningTime: 0, // Will be set by caller
      confidence: aiPlan.confidence,
      dependencies,
      estimatedDuration: aiPlan.estimatedDuration,
      plannedAt: new Date().toISOString(),
      reasoning: aiPlan.reasoning
    }

    return {
      steps,
      parallelGroups,
      planningMetadata,
      summary: aiPlan.summary
    }
  }

  /**
   * Parse the AI response to extract the plan
   */
  private parsePlanningResponse(response: string): z.infer<typeof ExecutionPlanSchema> | null {
    try {
      // Try to extract JSON from response
      let jsonText = response.trim()

      // Remove markdown code blocks if present
      jsonText = jsonText.replace(/```json\s*/g, '').replace(/```\s*/g, '')

      // Find JSON object in the response
      const jsonMatch = jsonText.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        jsonText = jsonMatch[0]
      }

      const parsed = JSON.parse(jsonText)

      // Validate using zod schema
      const validated = ExecutionPlanSchema.parse(parsed)

      console.log(`[TaskPlanningService] Successfully parsed planning response`)
      logger.info('Successfully parsed planning response')

      return validated
    } catch (error) {
      console.error(`[TaskPlanningService] Failed to parse planning response`, error)
      logger.error('Failed to parse planning response', error as Error)
      logger.error('Response text', { response })
      return null
    }
  }

  /**
   * Fallback to simple rule-based planning when AI is unavailable
   */
  generateFallbackPlan(targets: Array<{ type: string; id: string; name: string }>): TaskExecutionPlan {
    logger.info('Using fallback rule-based planning')

    // Create simple target objects to avoid circular references
    const createTarget = (t: { type: string; id: string; name: string }): TaskTarget => ({
      type: t.type as 'agent' | 'assistant' | 'agent_session',
      id: t.id,
      name: t.name
    })

    const assistants = targets.filter((t) => t.type === 'assistant').map(createTarget)
    const agents = targets.filter((t) => t.type === 'agent').map(createTarget)
    const agentSessions = targets.filter((t) => t.type === 'agent_session').map(createTarget)

    const parallelGroups: ParallelExecutionGroup[] = []
    const steps: ExecutionStep[] = []
    const dependencies: TaskDependency[] = []

    // Group assistants to run in parallel
    if (assistants.length > 0) {
      parallelGroups.push({
        targets: assistants,
        description: 'Execute all assistants in parallel',
        reason: 'Assistants generate independent responses'
      })
    }

    // Add agent sessions as sequential steps
    let order = 1
    agentSessions.forEach((session) => {
      steps.push({
        target: session,
        order: order++,
        reason: 'Agent sessions must run sequentially to maintain conversation context'
      })
    })

    // Add agents as sequential steps
    agents.forEach((agent) => {
      steps.push({
        target: agent,
        order: order++,
        reason: 'Agents run sequentially to avoid potential conflicts'
      })
    })

    return {
      steps,
      parallelGroups,
      planningMetadata: {
        modelUsed: 'rule-based',
        planningTime: 0,
        confidence: 0.5, // Lower confidence for rule-based
        dependencies,
        estimatedDuration: targets.length * 60, // Rough estimate
        plannedAt: new Date().toISOString(),
        reasoning: 'Fallback to rule-based planning: assistants parallel, agents sequential'
      },
      summary: `Rule-based plan: ${assistants.length} assistants in parallel, ${agents.length + agentSessions.length} sequential steps`
    }
  }
}

export default TaskPlanningService.getInstance()
