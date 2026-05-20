import * as z from 'zod'

import { createZodValidator } from '../agents/validators/zodValidator'

const JsonRecordSchema = z.record(z.string(), z.unknown())

const idParam = (name: string) => z.object({ [name]: z.string().min(1) })

export const validateWorkspaceId = createZodValidator({
  params: idParam('workspaceId')
})

export const validateRoomId = createZodValidator({
  params: idParam('roomId')
})

export const validateRunId = createZodValidator({
  params: idParam('runId')
})

export const validateMemberIdentity = createZodValidator({
  params: z.object({
    roomId: z.string().min(1),
    memberType: z.enum(['user', 'agent']),
    memberId: z.string().min(1)
  })
})

export const validateWorkerType = createZodValidator({
  params: z.object({
    workerType: z.enum(['codex', 'opencode', 'claude-code', 'gemini-cli', 'hermes'])
  })
})

export const validateReorderWorkers = createZodValidator({
  body: z.object({
    orderedKeys: z.array(z.enum(['codex', 'opencode', 'claude-code', 'gemini-cli', 'hermes'])).min(1)
  })
})

export const validateCreateWorkspace = createZodValidator({
  body: z.object({
    name: z.string().min(1),
    description: z.string().optional(),
    rootPaths: z.array(z.string()).optional(),
    routerAgentId: z.string().optional(),
    metadata: JsonRecordSchema.optional()
  })
})

export const validateUpdateWorkspace = createZodValidator({
  body: z.object({
    name: z.string().min(1).optional(),
    description: z.string().optional(),
    rootPaths: z.array(z.string()).optional(),
    routerAgentId: z.string().optional(),
    metadata: JsonRecordSchema.optional()
  })
})

export const validateCreateRoom = createZodValidator({
  body: z.object({
    workspaceId: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    status: z.enum(['todo', 'in_progress', 'needs_confirmation', 'done', 'blocked']).optional(),
    assignedAgentId: z.string().optional(),
    metadata: JsonRecordSchema.optional()
  })
})

export const validateUpdateRoom = createZodValidator({
  body: z.object({
    title: z.string().min(1).optional(),
    description: z.string().optional(),
    status: z.enum(['todo', 'in_progress', 'needs_confirmation', 'done', 'blocked']).optional(),
    assignedAgentId: z.string().optional(),
    metadata: JsonRecordSchema.optional()
  })
})

export const validateUpdateRoomAutonomy = createZodValidator({
  body: z.object({
    enabled: z.boolean().optional(),
    idleMinutes: z.number().min(1).max(1440).optional(),
    paused: z.boolean().optional(),
    routerAgentId: z.string().optional()
  })
})

export const validateCreateMember = createZodValidator({
  body: z.object({
    memberType: z.enum(['user', 'agent']),
    memberId: z.string().min(1),
    role: z.enum(['owner', 'participant']).optional(),
    displayName: z.string().optional(),
    metadata: JsonRecordSchema.optional()
  })
})

export const validateCreateMessage = createZodValidator({
  body: z.object({
    authorType: z.enum(['user', 'agent', 'system']),
    authorId: z.string().optional(),
    kind: z.enum(['message', 'task', 'event']).optional(),
    intent: z.enum(['message', 'task']).optional(),
    routing: z.enum(['none', 'elite']).optional(),
    parentMessageId: z.string().optional(),
    content: z.string().min(1),
    metadata: JsonRecordSchema.optional()
  })
})

export const validateAssignAndRun = createZodValidator({
  body: z.object({
    targetAgentId: z.string().min(1),
    content: z.string().min(1).optional(),
    attachments: z.array(JsonRecordSchema).optional(),
    reasoningEffort: z.string().optional(),
    permissionMode: z.string().optional(),
    toolsEnabled: z.boolean().optional()
  })
})

export const validateCreateRun = createZodValidator({
  body: z.object({
    workerAgentId: z.string().min(1),
    triggerMessageId: z.string().optional(),
    sessionId: z.string().optional(),
    status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']).optional(),
    commandSnapshot: z.string().optional(),
    argsSnapshot: z.array(z.string()).optional(),
    summary: z.string().optional(),
    result: z.string().optional(),
    error: z.string().optional()
  })
})

export const validateUpdateRun = createZodValidator({
  body: z.object({
    triggerMessageId: z.string().optional(),
    sessionId: z.string().optional(),
    status: z.enum(['queued', 'running', 'completed', 'failed', 'cancelled']).optional(),
    commandSnapshot: z.string().optional(),
    argsSnapshot: z.array(z.string()).optional(),
    summary: z.string().optional(),
    result: z.string().optional(),
    error: z.string().optional()
  })
})
