/**
 * TypeScript interfaces and validation for AI Agent system
 * 
 * This module provides:
 * - Type definitions for Agent, Session, and SessionLog entities
 * - Validation functions with comprehensive error checking
 * - Input sanitization to prevent XSS and other security issues
 * - Utility functions for model validation
 */

// =============================================================================
// ENUMS
// =============================================================================

export enum AgentStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  ERROR = 'error'
}

export enum SessionStatus {
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  STOPPED = 'stopped'
}

export enum LogLevel {
  DEBUG = 'debug',
  INFO = 'info',
  WARN = 'warn',
  ERROR = 'error'
}

// =============================================================================
// INTERFACES
// =============================================================================

export interface Tool {
  id: string
  name: string
  type: string
  config: Record<string, any>
}

export interface Knowledge {
  id: string
  name: string
  type: string
  source: string
}

export interface Agent {
  id: string
  name: string
  description?: string
  system_prompt: string
  model: string
  tools: Tool[]
  knowledges: Knowledge[]
  status: AgentStatus
  created_at: Date
  updated_at: Date
}

export interface Session {
  id: string
  agent_id: string
  status: SessionStatus
  started_at: Date
  ended_at: Date | null
}

export interface SessionLog {
  id: number
  session_id: string
  level: LogLevel
  message: string
  timestamp: Date
}

export interface AgentTemplate {
  id: string
  name: string
  description: string
  category: string
  system_prompt: string
  model: string
  tools: Tool[]
  knowledges: Knowledge[]
}

// =============================================================================
// VALIDATION FUNCTIONS
// =============================================================================

/**
 * Validates an Agent object for all required fields and constraints
 * @param agent The agent to validate
 * @throws Error if validation fails
 */
export function validateAgent(agent: Agent): void {
  validateAgentName(agent.name)
  validateSystemPrompt(agent.system_prompt)
  validateModelId(agent.model)
}

/**
 * Validates a Session object for all required fields
 * @param session The session to validate
 * @throws Error if validation fails
 */
export function validateSession(session: Session): void {
  if (!session.agent_id?.trim()) {
    throw new Error('Agent ID cannot be empty')
  }

  if (!Object.values(SessionStatus).includes(session.status)) {
    throw new Error('Invalid session status')
  }
}

/**
 * Validates a SessionLog object for all required fields
 * @param log The session log to validate
 * @throws Error if validation fails
 */
export function validateSessionLog(log: SessionLog): void {
  if (!log.session_id?.trim()) {
    throw new Error('Session ID cannot be empty')
  }

  if (!log.message?.trim()) {
    throw new Error('Log message cannot be empty')
  }

  if (!Object.values(LogLevel).includes(log.level)) {
    throw new Error('Invalid log level')
  }
}

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

function validateAgentName(name: string): void {
  if (!name?.trim()) {
    throw new Error('Agent name cannot be empty')
  }

  if (name.length > 100) {
    throw new Error('Agent name cannot exceed 100 characters')
  }
}

function validateSystemPrompt(prompt: string): void {
  if (!prompt?.trim()) {
    throw new Error('System prompt cannot be empty')
  }
}

function validateModelId(model: string): void {
  if (!isValidModelId(model)) {
    throw new Error('Invalid model ID')
  }
}

// =============================================================================
// SANITIZATION FUNCTIONS
// =============================================================================

export interface SanitizableInput {
  name?: string
  description?: string
  system_prompt?: string
}

/**
 * Sanitizes agent input to prevent XSS and other security issues
 * @param input The input object to sanitize
 * @returns Sanitized input object
 */
export function sanitizeAgentInput(input: SanitizableInput): SanitizableInput {
  const sanitized: SanitizableInput = {}

  if (input.name !== undefined) {
    sanitized.name = sanitizeString(input.name)
  }

  if (input.description !== undefined) {
    sanitized.description = sanitizeString(input.description)
  }

  if (input.system_prompt !== undefined) {
    sanitized.system_prompt = sanitizeString(input.system_prompt)
  }

  return sanitized
}

/**
 * Sanitizes a string by removing dangerous HTML/script content
 * @param input The string to sanitize
 * @returns Sanitized string
 */
function sanitizeString(input: string): string {
  return input
    .trim()
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Checks if a model ID is valid and supported
 * @param modelId The model ID to validate
 * @returns True if the model ID is valid
 */
export function isValidModelId(modelId: string | null | undefined): boolean {
  if (!modelId) return false

  const validModels = [
    'gpt-4',
    'gpt-4-turbo', 
    'gpt-3.5-turbo',
    'claude-3-sonnet',
    'claude-3-opus',
    'gemini-pro'
  ]

  return validModels.includes(modelId)
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Type guard to check if an object is a valid Agent
 * @param obj The object to check
 * @returns True if the object is a valid Agent
 */
export function isAgent(obj: any): obj is Agent {
  return (
    obj &&
    typeof obj.id === 'string' &&
    typeof obj.name === 'string' &&
    typeof obj.system_prompt === 'string' &&
    typeof obj.model === 'string' &&
    Array.isArray(obj.tools) &&
    Array.isArray(obj.knowledges) &&
    Object.values(AgentStatus).includes(obj.status) &&
    obj.created_at instanceof Date &&
    obj.updated_at instanceof Date
  )
}