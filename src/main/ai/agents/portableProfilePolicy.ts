import type { PortableProfileSanitization } from '@data/portableProfilePolicy'
import { isAgentRuntimeConfigCaptureExcluded as isSkillRuntimeConfigCaptureExcluded } from '@main/ai/skills/capturePolicy'
import {
  type AgentConfiguration,
  type AgentConfigurationField,
  type AgentPermissionMode,
  AgentPermissionModeSchema,
  sanitizeAgentConfiguration
} from '@shared/data/api/schemas/agents'
import * as z from 'zod'

const PORTABLE_AGENT_RESUME_POINT_PREFIX = 'cherry-agent-resume-v1:'

const PortableAgentResumePointSchema = z.strictObject({
  // Both fields come from Claude SDK messages and are UUIDs in its public
  // contract. Enforcing that when reading detached DB data also prevents
  // object-key/path edge cases from becoming a supposedly portable token.
  sessionId: z.uuid(),
  resumeSessionAt: z.uuid().optional()
})

export type PortableAgentResumePoint = z.infer<typeof PortableAgentResumePointSchema>

/**
 * Restore keeps agent configuration as data, but it must not carry automation
 * or producer-device permission bypasses into an active target profile.
 */
export type PortableAgentPermissionMode = Exclude<AgentPermissionMode, 'bypassPermissions'>

export type PortableAgentConfiguration = Omit<
  AgentConfiguration,
  'heartbeat_enabled' | 'scheduler_enabled' | 'permission_mode'
> & {
  heartbeat_enabled: false
  scheduler_enabled: false
  permission_mode?: PortableAgentPermissionMode
}

export interface AgentAutomationPatch {
  readonly configuration: PortableAgentConfiguration
}

export type AgentAutomationMalformedField = AgentConfigurationField | '<root>'

export type AgentAutomationSanitization = PortableProfileSanitization<
  AgentAutomationPatch,
  AgentAutomationMalformedField
>

/** Target-local parent for workspace rows that cannot retain their source binding. */
export const DISCONNECTED_AGENT_WORKSPACE_DIRECTORY = 'disconnected-workspaces'

export function encodePortableAgentResumePoint(point: PortableAgentResumePoint): string {
  const parsed = PortableAgentResumePointSchema.parse(point)
  return `${PORTABLE_AGENT_RESUME_POINT_PREFIX}${Buffer.from(JSON.stringify(parsed), 'utf8').toString('base64url')}`
}

export function isPortableAgentResumeToken(value: string | null | undefined): boolean {
  if (!value?.startsWith(PORTABLE_AGENT_RESUME_POINT_PREFIX)) return false
  try {
    decodePortableAgentResumePoint(value)
    return true
  } catch {
    return false
  }
}

/**
 * Pre-feature values are raw Claude session ids. Keep reading them so an
 * existing profile can establish its first managed transcript on the next
 * successful Turn.
 */
export function decodePortableAgentResumePoint(value: string | null | undefined): PortableAgentResumePoint | undefined {
  if (!value) return undefined
  if (!value.startsWith(PORTABLE_AGENT_RESUME_POINT_PREFIX)) return { sessionId: value }

  try {
    const parsed = PortableAgentResumePointSchema.parse(
      JSON.parse(Buffer.from(value.slice(PORTABLE_AGENT_RESUME_POINT_PREFIX.length), 'base64url').toString('utf8'))
    )
    return parsed
  } catch {
    throw new Error('Malformed portable Agent resume point')
  }
}

/**
 * Runtime config excludes owner-managed projections/caches:
 * - `skills/` is rebuilt by Skill owner from `Data/Skills`.
 * - `projects/` is the SDK's cwd-keyed live JSONL cache. Agent transports its
 *   workspace-independent, completed-Turn sessionStore under canonical data.
 */
export function isAgentRuntimeConfigCaptureExcluded(relativePath: string): boolean {
  return (
    isSkillRuntimeConfigCaptureExcluded(relativePath) ||
    relativePath === 'projects' ||
    relativePath.startsWith('projects/')
  )
}

/** Reduce an untrusted row id to one inert, portable path segment. */
export function toDisconnectedAgentWorkspaceSegment(id: string): string {
  return `ws-${id
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .slice(0, 64)
    .replace(/\.+$/, '')}`
}

/**
 * Keep a known, non-bypassing permission mode. Unknown values and
 * `bypassPermissions` fall back to the target default.
 */
export function sanitizePermissionMode(value: unknown): PortableAgentPermissionMode | null {
  const parsed = AgentPermissionModeSchema.safeParse(value)
  return parsed.success && parsed.data !== 'bypassPermissions' ? parsed.data : null
}

/**
 * Return the inert configuration an archive may carry for one agent.
 *
 * The heartbeat reader is opt-out, so both automation flags must be written
 * `false` even when the stored root is absent or malformed. Unknown,
 * non-automatic configuration remains available for a later user-initiated run.
 */
export function sanitizeAgentAutomation(raw: unknown): AgentAutomationSanitization {
  const { data, invalidKeys } = sanitizeAgentConfiguration(raw)
  const { permission_mode: permissionMode, ...preserved } = data ?? {}
  const configuration: PortableAgentConfiguration = {
    ...preserved,
    heartbeat_enabled: false,
    scheduler_enabled: false
  }
  const mode = sanitizePermissionMode(permissionMode)
  if (mode !== null) configuration.permission_mode = mode

  return { patch: { configuration }, malformedFields: invalidKeys }
}
