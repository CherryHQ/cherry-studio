/**
 * Task Planning Renderer Service
 * Handles AI-powered task planning using aiCore in the renderer process
 */

import { loggerService } from '@logger'
import AiProvider from '@renderer/aiCore'
import type { Model, Provider } from '@renderer/types'

const logger = loggerService.withContext('TaskPlanningRendererService')

export interface PlanningRequest {
  taskName: string
  taskDescription?: string
  targets: Array<{ type: string; id: string; name: string }>
  message: string
  planModel: string // Format: "provider:model"
}

export interface PlanningResult {
  success: boolean
  plan?: {
    summary: string
    reasoning: string
    confidence: number
    estimatedDuration: number
    parallelGroups: Array<{
      targets: number[]
      description: string
      estimatedDuration?: number
      reason: string
    }>
    sequentialSteps: Array<{
      targetIndex: number
      order: number
      reason: string
      estimatedDuration?: number
    }>
    dependencies: Array<{
      from: number
      to: number
      reason: string
      type: 'sequential' | 'parallel' | 'conditional'
    }>
  }
  error?: string
  duration: number
}

class TaskPlanningRendererService {
  private static instance: TaskPlanningRendererService | null = null

  private constructor() {
    logger.info('TaskPlanningRendererService initialized')
  }

  public static getInstance(): TaskPlanningRendererService {
    if (!TaskPlanningRendererService.instance) {
      TaskPlanningRendererService.instance = new TaskPlanningRendererService()
    }
    return TaskPlanningRendererService.instance
  }

  /**
   * Generate an execution plan using AI
   */
  async generateExecutionPlan(request: PlanningRequest, provider: Provider, model: Model): Promise<PlanningResult> {
    const startTime = Date.now()

    try {
      logger.info('Generating execution plan', {
        taskName: request.taskName,
        targetsCount: request.targets.length,
        model: model.id
      })

      // Single target - no planning needed
      if (request.targets.length <= 1) {
        return {
          success: true,
          plan: {
            summary: 'Single target execution',
            reasoning: 'Single target, no planning needed',
            confidence: 1.0,
            estimatedDuration: 60,
            parallelGroups: [],
            sequentialSteps: [
              {
                targetIndex: 0,
                order: 1,
                reason: 'Single target, no planning needed'
              }
            ],
            dependencies: []
          },
          duration: Date.now() - startTime
        }
      }

      // Create planning prompt
      const prompt = this.createPlanningPrompt(request)

      // Use aiCore to generate plan
      const aiProvider = new AiProvider(provider)

      // Build the planning system message
      const systemMessage = this.getPlanningSystemMessage()

      const result = await aiProvider.completions({
        assistant: {
          id: 'planning-assistant',
          name: 'Planning Assistant',
          prompt: systemMessage,
          topics: [],
          type: 'planning',
          model
        } as any,
        messages: [
          {
            role: 'system',
            content: systemMessage
          } as any,
          {
            role: 'user',
            content: prompt
          } as any
        ],
        streamOutput: false,
        callType: 'planning' as any
      })

      logger.info('AI response received', {
        duration: Date.now() - startTime
      })

      // Parse the response
      const responseText = result.getText ? result.getText() : ''

      // Try to extract JSON from response
      const plan = this.parsePlanningResponse(responseText)

      if (!plan) {
        throw new Error('Failed to parse planning response from AI')
      }

      logger.info('Planning completed successfully', {
        confidence: plan.confidence,
        estimatedDuration: plan.estimatedDuration
      })

      return {
        success: true,
        plan,
        duration: Date.now() - startTime
      }
    } catch (error) {
      logger.error('Failed to generate execution plan', error as Error)
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
        duration: Date.now() - startTime
      }
    }
  }

  /**
   * Create the planning prompt
   */
  private createPlanningPrompt(request: PlanningRequest): string {
    const targetsList = request.targets.map((t, i) => `${i + 1}. ${t.name} (Type: ${t.type}, ID: ${t.id})`).join('\n')

    return `# Task Information
**Task Name:** ${request.taskName}
${request.taskDescription ? `**Description:** ${request.taskDescription}` : ''}

# Targets to Execute
${targetsList}

# Message to Send
${request.message}

# Your Task
Please analyze the targets and create an optimized execution plan in JSON format.

# Planning Guidelines
- **Assistants** can typically run in parallel (they generate independent responses)
- **Agents** should generally run sequentially (they may have complex state/dependencies)
- **Agent Sessions** must run sequentially (they maintain conversation context)
- Consider the message content when determining dependencies
- Be conservative with parallelization - it's better to be safe than to have conflicts

# Output Format
Return ONLY a JSON object (no markdown, no code blocks):
{
  "summary": "Brief summary of the plan",
  "reasoning": "Explanation of your planning decisions",
  "confidence": 0.85,
  "estimatedDuration": 300,
  "parallelGroups": [
    {
      "targets": [0, 1],
      "description": "Why these can run in parallel",
      "estimatedDuration": 60,
      "reason": "Both are assistants generating independent responses"
    }
  ],
  "sequentialSteps": [
    {
      "targetIndex": 2,
      "order": 1,
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
   * Get the planning system message
   */
  private getPlanningSystemMessage(): string {
    return `You are an AI task planning assistant. Your job is to analyze a task with multiple targets and create an optimal execution plan.

# Your Capabilities
- Analyze task targets and their dependencies
- Identify which targets can run in parallel
- Determine the optimal order for sequential execution
- Estimate execution time for each step/group
- Provide clear reasoning for your planning decisions

# Planning Strategy
1. **Parallelization**: Targets that don't depend on each other's results should run in parallel
2. **Dependencies**: Identify explicit and implicit dependencies between targets
3. **Efficiency**: Minimize total execution time while ensuring correctness
4. **Clarity**: Provide clear reasoning for each planning decision

# Target Types
- **Assistants**: Generate independent responses, typically safe to parallelize
- **Agents**: May have complex state, default to sequential execution
- **Agent Sessions**: Maintain conversation context, must be sequential

# Output Requirements
- Return ONLY valid JSON (no markdown formatting, no code blocks)
- Use 0-based indices for all target references
- Be realistic with time estimates
- Confidence should reflect uncertainty in your planning (0-1 scale)

Now analyze the task and create the optimal execution plan.`
  }

  /**
   * Parse the AI response to extract the plan
   */
  private parsePlanningResponse(response: string): PlanningResult['plan'] | null {
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

      // Validate required fields
      if (!parsed.summary || !parsed.reasoning || typeof parsed.confidence !== 'number') {
        throw new Error('Invalid planning response: missing required fields')
      }

      if (!Array.isArray(parsed.parallelGroups) || !Array.isArray(parsed.sequentialSteps)) {
        throw new Error('Invalid planning response: missing arrays')
      }

      return parsed
    } catch (error) {
      logger.error('Failed to parse planning response', error as Error)
      logger.error('Response text', { response })
      return null
    }
  }
}

export default TaskPlanningRendererService.getInstance()
