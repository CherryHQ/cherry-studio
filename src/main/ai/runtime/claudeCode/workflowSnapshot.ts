import path from 'node:path'

import {
  type AgentWorkflowAgentProgress,
  type AgentWorkflowSnapshot,
  parseAgentWorkflowSnapshot
} from '@shared/ai/agentWorkflowProgress'

export interface LocalWorkflowLaunch {
  taskId: string
  runId: string
  workflowName?: string
  transcriptDir?: string
  snapshotPath: string
  createdAt: string
}

export interface LocalWorkflowPlan {
  phases: Array<{ title: string }>
  agents: Array<{
    label: string
    phaseIndex: number
    phaseTitle: string
  }>
}

interface ScriptToken {
  type: 'identifier' | 'punctuation' | 'string'
  value?: string
}

const REGEX_PREFIX_IDENTIFIERS = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield'
])
const REGEX_PREFIX_PUNCTUATION = new Set([
  '!',
  '%',
  '&',
  '(',
  '*',
  '+',
  ',',
  '-',
  ':',
  ';',
  '<',
  '=',
  '>',
  '?',
  '[',
  '^',
  '{',
  '|',
  '~'
])

function readEscape(source: string, start: number): { end: number; value: string } {
  const escaped = source[start + 1]
  if (escaped === undefined) return { end: source.length, value: '' }
  if (escaped === '\r' || escaped === '\n') {
    return { end: escaped === '\r' && source[start + 2] === '\n' ? start + 3 : start + 2, value: '' }
  }

  const simple: Record<string, string> = {
    0: '\0',
    b: '\b',
    f: '\f',
    n: '\n',
    r: '\r',
    t: '\t',
    v: '\v'
  }
  if (escaped in simple) return { end: start + 2, value: simple[escaped] }

  const prefixLength = escaped === 'x' ? 2 : escaped === 'u' ? 4 : 0
  if (prefixLength) {
    const braced = escaped === 'u' && source[start + 2] === '{'
    const hexEnd = braced ? source.indexOf('}', start + 3) : start + 2 + prefixLength
    const hex = braced ? source.slice(start + 3, hexEnd) : source.slice(start + 2, hexEnd)
    if (hexEnd >= 0 && /^[\da-f]+$/i.test(hex)) {
      const codePoint = Number.parseInt(hex, 16)
      if (codePoint <= 0x10ffff) {
        return { end: braced ? hexEnd + 1 : hexEnd, value: String.fromCodePoint(codePoint) }
      }
    }
  }

  return { end: start + 2, value: escaped }
}

function readStringToken(source: string, start: number): { end: number; value?: string } {
  const quote = source[start]
  let index = start + 1
  let value = ''
  let isStatic = true

  while (index < source.length) {
    const current = source[index]
    if (current === '\\') {
      const escape = readEscape(source, index)
      value += escape.value
      index = escape.end
      continue
    }
    if (current === quote) return { end: index + 1, ...(isStatic ? { value } : {}) }
    if (quote === '`' && current === '$' && source[index + 1] === '{') {
      isStatic = false
      index = skipTemplateExpression(source, index + 2)
      continue
    }
    value += current
    index += 1
  }

  return { end: source.length }
}

function skipTemplateExpression(source: string, start: number): number {
  let depth = 1
  let index = start
  while (index < source.length) {
    const current = source[index]
    if (current === "'" || current === '"' || current === '`') {
      index = readStringToken(source, index).end
      continue
    }
    if (current === '/' && source[index + 1] === '/') {
      const lineEnd = source.indexOf('\n', index + 2)
      index = lineEnd < 0 ? source.length : lineEnd + 1
      continue
    }
    if (current === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2)
      index = commentEnd < 0 ? source.length : commentEnd + 2
      continue
    }
    if (current === '{') depth += 1
    if (current === '}' && --depth === 0) return index + 1
    index += 1
  }
  return source.length
}

function shouldReadRegex(previous: ScriptToken | undefined): boolean {
  if (!previous) return true
  if (previous.type === 'identifier') return !!previous.value && REGEX_PREFIX_IDENTIFIERS.has(previous.value)
  return previous.type === 'punctuation' && !!previous.value && REGEX_PREFIX_PUNCTUATION.has(previous.value)
}

function skipRegexLiteral(source: string, start: number): number {
  let index = start + 1
  let inCharacterClass = false
  while (index < source.length) {
    const current = source[index]
    if (current === '\\') {
      index += 2
      continue
    }
    if (current === '[') inCharacterClass = true
    if (current === ']') inCharacterClass = false
    if (current === '/' && !inCharacterClass) {
      index += 1
      while (/[a-z]/i.test(source[index] ?? '')) index += 1
      return index
    }
    index += 1
  }
  return source.length
}

function tokenizeWorkflowScript(source: string): ScriptToken[] {
  const tokens: ScriptToken[] = []
  let index = 0
  while (index < source.length) {
    const current = source[index]
    if (/\s/.test(current)) {
      index += 1
      continue
    }
    if (current === '/' && source[index + 1] === '/') {
      const lineEnd = source.indexOf('\n', index + 2)
      index = lineEnd < 0 ? source.length : lineEnd + 1
      continue
    }
    if (current === '/' && source[index + 1] === '*') {
      const commentEnd = source.indexOf('*/', index + 2)
      index = commentEnd < 0 ? source.length : commentEnd + 2
      continue
    }
    if (current === "'" || current === '"' || current === '`') {
      const token = readStringToken(source, index)
      tokens.push({ type: 'string', value: token.value })
      index = token.end
      continue
    }
    if (current === '/' && shouldReadRegex(tokens.at(-1))) {
      index = skipRegexLiteral(source, index)
      continue
    }
    if (/[A-Za-z_$]/.test(current)) {
      let end = index + 1
      while (/[\w$]/.test(source[end] ?? '')) end += 1
      tokens.push({ type: 'identifier', value: source.slice(index, end) })
      index = end
      continue
    }
    tokens.push({ type: 'punctuation', value: current })
    index += 1
  }
  return tokens
}

function findMatchingToken(tokens: ScriptToken[], openIndex: number): number | undefined {
  const open = tokens[openIndex]?.value
  const close = open === '(' ? ')' : open === '[' ? ']' : open === '{' ? '}' : undefined
  if (!close) return undefined
  let depth = 0
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === open) depth += 1
    if (tokens[index].value === close && --depth === 0) return index
  }
  return undefined
}

function findStaticProperty(
  tokens: ScriptToken[],
  objectOpen: number,
  objectClose: number,
  property: string
): string | undefined {
  let depth = 0
  for (let index = objectOpen + 1; index < objectClose; index += 1) {
    const value = tokens[index].value
    if (value === '(' || value === '[' || value === '{') {
      depth += 1
      continue
    }
    if (value === ')' || value === ']' || value === '}') {
      depth -= 1
      continue
    }
    if (depth === 0 && value === property && tokens[index + 1]?.value === ':' && tokens[index + 2]?.type === 'string') {
      return tokens[index + 2].value
    }
  }
  return undefined
}

function parseWorkflowPhases(tokens: ScriptToken[]): Array<{ title: string }> {
  const phases: Array<{ title: string }> = []
  const metaIndex = tokens.findIndex(
    (token, index) => token.value === 'meta' && tokens[index + 1]?.value === '=' && tokens[index + 2]?.value === '{'
  )
  if (metaIndex < 0) return phases
  const metaOpen = metaIndex + 2
  const metaClose = findMatchingToken(tokens, metaOpen)
  if (metaClose === undefined) return phases

  let depth = 0
  let phasesOpen: number | undefined
  for (let index = metaOpen + 1; index < metaClose; index += 1) {
    const value = tokens[index].value
    if (value === '(' || value === '[' || value === '{') depth += 1
    else if (value === ')' || value === ']' || value === '}') depth -= 1
    else if (
      depth === 0 &&
      value === 'phases' &&
      tokens[index + 1]?.value === ':' &&
      tokens[index + 2]?.value === '['
    ) {
      phasesOpen = index + 2
      break
    }
  }
  if (phasesOpen === undefined) return phases
  const phasesClose = findMatchingToken(tokens, phasesOpen)
  if (phasesClose === undefined) return phases

  for (let index = phasesOpen + 1; index < phasesClose; index += 1) {
    if (tokens[index].value !== '{') continue
    const phaseClose = findMatchingToken(tokens, index)
    if (phaseClose === undefined || phaseClose > phasesClose) break
    const title = findStaticProperty(tokens, index, phaseClose, 'title')
    if (title) phases.push({ title })
    index = phaseClose
  }
  return phases
}

function findAgentOptions(tokens: ScriptToken[], callOpen: number, callClose: number): [number, number] | undefined {
  let depth = 0
  let passedPrompt = false
  for (let index = callOpen + 1; index < callClose; index += 1) {
    const value = tokens[index].value
    if (depth === 0 && value === ',') {
      passedPrompt = true
      continue
    }
    if (depth === 0 && passedPrompt && value === '{') {
      const optionsClose = findMatchingToken(tokens, index)
      return optionsClose === undefined ? undefined : [index, optionsClose]
    }
    if (value === '(' || value === '[' || value === '{') depth += 1
    else if (value === ')' || value === ']' || value === '}') depth -= 1
  }
  return undefined
}

export function parseLocalWorkflowPlan(script: string): LocalWorkflowPlan | undefined {
  const tokens = tokenizeWorkflowScript(script)
  const phases = parseWorkflowPhases(tokens)
  const phaseIndexes = new Map(phases.map((phase, index) => [phase.title, index + 1]))
  const agents: LocalWorkflowPlan['agents'] = []

  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index].value !== 'agent' || tokens[index + 1].value !== '(' || tokens[index - 1]?.value === '.') {
      continue
    }
    const callClose = findMatchingToken(tokens, index + 1)
    if (callClose === undefined) continue
    const options = findAgentOptions(tokens, index + 1, callClose)
    if (!options) continue
    const label = findStaticProperty(tokens, options[0], options[1], 'label')
    const phaseTitle = findStaticProperty(tokens, options[0], options[1], 'phase')
    if (!label || !phaseTitle) continue
    let phaseIndex = phaseIndexes.get(phaseTitle)
    if (!phaseIndex) {
      phaseIndex = phases.length + 1
      phases.push({ title: phaseTitle })
      phaseIndexes.set(phaseTitle, phaseIndex)
    }
    agents.push({ label, phaseIndex, phaseTitle })
  }

  return phases.length || agents.length ? { phases, agents } : undefined
}

function getActiveWorkflowAgent(
  phases: Array<{ title: string }>,
  description?: string,
  lastToolName?: string
): { label: string; phaseTitle: string } | undefined {
  let label = lastToolName?.trim()
  let phaseTitle: string | undefined
  if (label && description?.endsWith(`: ${label}`)) phaseTitle = description.slice(0, -(label.length + 2)).trim()
  if (!label && description) {
    const separator = description.lastIndexOf(': ')
    if (separator > 0) {
      phaseTitle = description.slice(0, separator).trim()
      label = description.slice(separator + 2).trim()
    }
  }
  if (!phaseTitle && description) {
    phaseTitle = phases.find((phase) => description.startsWith(`${phase.title}:`))?.title
  }
  return label && phaseTitle ? { label, phaseTitle } : undefined
}

function normalizeRuntimeAgentState(state: string): string {
  switch (state.trim().toLowerCase()) {
    case 'start':
    case 'progress':
      return 'running'
    case 'error':
      return 'failed'
    default:
      return state
  }
}

function normalizeRuntimeWorkflowProgress(progress: unknown[]): unknown[] {
  return progress.map((item) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return item
    const agent = item as Record<string, unknown>
    if (agent.type !== 'workflow_agent' || typeof agent.state !== 'string') return item

    const state = normalizeRuntimeAgentState(agent.state)
    const startedAt = agent.startedAt
    const lastProgressAt = agent.lastProgressAt
    const hasDuration =
      typeof agent.durationMs === 'number' && Number.isInteger(agent.durationMs) && agent.durationMs >= 0
    return {
      ...agent,
      state,
      ...(!hasDuration &&
      state === 'running' &&
      typeof startedAt === 'number' &&
      Number.isInteger(startedAt) &&
      typeof lastProgressAt === 'number' &&
      Number.isInteger(lastProgressAt)
        ? { durationMs: Math.max(0, lastProgressAt - startedAt) }
        : {})
    }
  })
}

interface AgentPositions {
  first: number
  positions: Set<number>
}

function addAgentPosition<Key>(lookup: Map<Key, AgentPositions>, key: Key, position: number): void {
  const existing = lookup.get(key)
  if (existing) {
    existing.positions.add(position)
    existing.first = Math.min(existing.first, position)
  } else {
    lookup.set(key, { first: position, positions: new Set([position]) })
  }
}

function removeAgentPosition<Key>(lookup: Map<Key, AgentPositions>, key: Key, position: number): void {
  const existing = lookup.get(key)
  if (!existing) return
  existing.positions.delete(position)
  if (existing.positions.size === 0) {
    lookup.delete(key)
  } else if (existing.first === position) {
    existing.first = Number.POSITIVE_INFINITY
    for (const remaining of existing.positions) existing.first = Math.min(existing.first, remaining)
  }
}

export function updateLocalWorkflowSnapshot(
  plan: LocalWorkflowPlan,
  launch: Pick<LocalWorkflowLaunch, 'taskId' | 'runId' | 'workflowName'>,
  update: {
    status: string
    description?: string
    lastToolName?: string
    usage?: { contextTokens?: number; toolUses?: number; durationMs?: number }
    workflowProgress?: unknown
  },
  previous?: AgentWorkflowSnapshot
): AgentWorkflowSnapshot {
  const phases = [...plan.phases]
  const phaseTitles = new Set(phases.map((phase) => phase.title))
  for (const phase of previous?.phases ?? []) {
    if (phaseTitles.has(phase.title)) continue
    phases.push(phase)
    phaseTitles.add(phase.title)
  }

  const runtimeWorkflowProgress = Array.isArray(update.workflowProgress) ? update.workflowProgress : undefined
  const runtimeWorkflow = runtimeWorkflowProgress
    ? parseAgentWorkflowSnapshot(
        {
          runId: launch.runId,
          taskId: launch.taskId,
          ...(launch.workflowName ? { workflowName: launch.workflowName } : {}),
          phases: plan.phases,
          workflowProgress: normalizeRuntimeWorkflowProgress(runtimeWorkflowProgress)
        },
        launch
      )
    : undefined
  for (const progress of runtimeWorkflow?.workflowProgress ?? []) {
    if (progress.type === 'workflow_phase' && !phaseTitles.has(progress.title)) {
      phases.push({ title: progress.title })
      phaseTitles.add(progress.title)
    }
  }

  const previousAgents = new Map<number, AgentWorkflowAgentProgress>()
  for (const progress of previous?.workflowProgress ?? []) {
    if (progress.type === 'workflow_agent') previousAgents.set(progress.index, progress)
  }
  const agents: AgentWorkflowAgentProgress[] = plan.agents.map((agent, offset) => {
    const index = offset + 1
    const existing = previousAgents.get(index)
    return existing?.label === agent.label && existing.phaseTitle === agent.phaseTitle
      ? { ...existing, ...agent, index }
      : { type: 'workflow_agent', ...agent, index, state: 'pending' }
  })
  const positionsByIndex = new Map<number, AgentPositions>()
  const positionsByPhase = new Map<string, Map<string, AgentPositions>>()
  const registerAgentPosition = (agent: AgentWorkflowAgentProgress, position: number) => {
    addAgentPosition(positionsByIndex, agent.index, position)
    let labels = positionsByPhase.get(agent.phaseTitle)
    if (!labels) {
      labels = new Map()
      positionsByPhase.set(agent.phaseTitle, labels)
    }
    addAgentPosition(labels, agent.label, position)
  }
  agents.forEach(registerAgentPosition)
  for (const agent of previousAgents.values()) {
    if (positionsByIndex.has(agent.index)) continue
    agents.push({ ...agent })
    registerAgentPosition(agent, agents.length - 1)
  }

  for (const runtimeAgent of runtimeWorkflow?.workflowProgress ?? []) {
    if (runtimeAgent.type !== 'workflow_agent') continue
    // Keep the earliest match even when a label matches before the reported index.
    const existingIndex = Math.min(
      positionsByIndex.get(runtimeAgent.index)?.first ?? Number.POSITIVE_INFINITY,
      positionsByPhase.get(runtimeAgent.phaseTitle)?.get(runtimeAgent.label)?.first ?? Number.POSITIVE_INFINITY
    )
    if (existingIndex < agents.length) {
      const existing = agents[existingIndex]
      if (existing.index !== runtimeAgent.index) {
        removeAgentPosition(positionsByIndex, existing.index, existingIndex)
      }
      if (existing.phaseTitle !== runtimeAgent.phaseTitle || existing.label !== runtimeAgent.label) {
        const labels = positionsByPhase.get(existing.phaseTitle)
        if (labels) removeAgentPosition(labels, existing.label, existingIndex)
      }
      agents[existingIndex] = { ...existing, ...runtimeAgent }
      registerAgentPosition(agents[existingIndex], existingIndex)
    } else {
      agents.push(runtimeAgent)
      registerAgentPosition(runtimeAgent, agents.length - 1)
    }
  }

  const active = runtimeWorkflowProgress
    ? undefined
    : getActiveWorkflowAgent(phases, update.description, update.lastToolName)
  if (active) {
    let phaseIndex = phases.findIndex((phase) => phase.title === active.phaseTitle) + 1
    if (!phaseIndex) {
      phases.push({ title: active.phaseTitle })
      phaseIndex = phases.length
    }
    for (const agent of agents) {
      if (agent.phaseIndex < phaseIndex && ['pending', 'running'].includes(agent.state)) agent.state = 'done'
    }
    let agent = agents.find(
      (candidate) =>
        candidate.phaseIndex === phaseIndex &&
        candidate.label === active.label &&
        ['pending', 'running'].includes(candidate.state)
    )
    if (!agent) {
      agent = {
        type: 'workflow_agent',
        index: Math.max(0, ...agents.map((candidate) => candidate.index)) + 1,
        label: active.label,
        phaseIndex,
        phaseTitle: active.phaseTitle,
        state: 'pending'
      }
      agents.push(agent)
    }
    agent.state = 'running'
  }

  if (update.status !== 'in_progress') {
    const terminalState = update.status === 'completed' ? 'done' : update.status === 'error' ? 'failed' : 'interrupted'
    for (const agent of agents) {
      if (agent.state === 'running') agent.state = terminalState
    }
  }

  const usage = update.usage
  let hasAgentTokens = false
  let hasAgentToolCalls = false
  let agentTotalTokens = 0
  let agentTotalCumulativeTokens = 0
  let agentTotalToolCalls = 0
  for (const agent of agents) {
    hasAgentTokens ||= agent.tokens !== undefined
    hasAgentToolCalls ||= agent.toolCalls !== undefined
    agentTotalTokens += agent.tokens ?? 0
    agentTotalCumulativeTokens += agent.cumulativeTokens ?? 0
    agentTotalToolCalls += agent.toolCalls ?? 0
  }
  const totalTokens =
    update.status === 'in_progress' && hasAgentTokens
      ? agentTotalTokens
      : (usage?.contextTokens ?? (hasAgentTokens ? agentTotalTokens : previous?.totalTokens))
  const totalCumulativeTokens =
    agentTotalCumulativeTokens > 0 || previous?.totalCumulativeTokens !== undefined
      ? Math.max(agentTotalCumulativeTokens, previous?.totalCumulativeTokens ?? 0)
      : undefined
  const totalToolCalls =
    update.status === 'in_progress' && hasAgentToolCalls
      ? agentTotalToolCalls
      : (usage?.toolUses ?? (hasAgentToolCalls ? agentTotalToolCalls : previous?.totalToolCalls))
  return {
    runId: launch.runId,
    taskId: launch.taskId,
    ...(launch.workflowName ? { workflowName: launch.workflowName } : {}),
    ...(usage?.durationMs !== undefined || previous?.durationMs !== undefined
      ? { durationMs: usage?.durationMs ?? previous?.durationMs }
      : {}),
    ...(totalTokens !== undefined ? { totalTokens } : {}),
    ...(totalCumulativeTokens !== undefined ? { totalCumulativeTokens } : {}),
    ...(totalToolCalls !== undefined ? { totalToolCalls } : {}),
    phases,
    workflowProgress: [
      ...phases.map((phase, offset) => ({ type: 'workflow_phase' as const, index: offset + 1, title: phase.title })),
      ...agents.toSorted((left, right) => left.index - right.index)
    ]
  }
}

function getNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function isSafeRunId(runId: string): boolean {
  return runId !== '.' && runId !== '..' && !runId.includes('/') && !runId.includes('\\')
}

function normalizePathForComparison(value: string): string {
  const normalized = path.normalize(path.resolve(value))
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function resolveSnapshotFromTranscriptDir(runId: string, transcriptDir: string): string | undefined {
  const resolvedTranscriptDir = path.resolve(transcriptDir)
  if (path.basename(resolvedTranscriptDir) !== runId) return undefined

  const transcriptWorkflowsDir = path.dirname(resolvedTranscriptDir)
  if (path.basename(transcriptWorkflowsDir) !== 'workflows') return undefined

  const subagentsDir = path.dirname(transcriptWorkflowsDir)
  if (path.basename(subagentsDir) !== 'subagents') return undefined

  return path.join(path.dirname(subagentsDir), 'workflows', `${runId}.json`)
}

function resolveSnapshotFromScriptPath(runId: string, scriptPath: string): string | undefined {
  const resolvedScriptPath = path.resolve(scriptPath)
  if (!path.basename(resolvedScriptPath).endsWith(`-${runId}.js`)) return undefined

  const scriptsDir = path.dirname(resolvedScriptPath)
  if (path.basename(scriptsDir) !== 'scripts') return undefined

  const workflowsDir = path.dirname(scriptsDir)
  if (path.basename(workflowsDir) !== 'workflows') return undefined

  return path.join(workflowsDir, `${runId}.json`)
}

export function parseLocalWorkflowLaunch(value: unknown, createdAt: string): LocalWorkflowLaunch | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
  const receipt = value as Record<string, unknown>
  if (receipt.status !== 'async_launched' || receipt.taskType !== 'local_workflow') return undefined

  const taskId = getNonEmptyString(receipt.taskId)
  const runId = getNonEmptyString(receipt.runId)
  if (!taskId || !runId || !isSafeRunId(runId)) return undefined

  const transcriptDir = getNonEmptyString(receipt.transcriptDir)
  const scriptPath = getNonEmptyString(receipt.scriptPath)
  const transcriptSnapshotPath = transcriptDir ? resolveSnapshotFromTranscriptDir(runId, transcriptDir) : undefined
  const scriptSnapshotPath = scriptPath ? resolveSnapshotFromScriptPath(runId, scriptPath) : undefined
  if (
    transcriptSnapshotPath &&
    scriptSnapshotPath &&
    normalizePathForComparison(transcriptSnapshotPath) !== normalizePathForComparison(scriptSnapshotPath)
  ) {
    return undefined
  }

  const snapshotPath = transcriptSnapshotPath ?? scriptSnapshotPath
  if (!snapshotPath) return undefined

  const workflowName = getNonEmptyString(receipt.workflowName)
  return {
    taskId,
    runId,
    ...(workflowName ? { workflowName } : {}),
    ...(transcriptSnapshotPath && transcriptDir ? { transcriptDir: path.resolve(transcriptDir) } : {}),
    snapshotPath,
    createdAt
  }
}

export function parseWorkflowSnapshotText(
  text: string,
  launch: Pick<LocalWorkflowLaunch, 'taskId' | 'runId' | 'workflowName'>
): AgentWorkflowSnapshot | undefined {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return undefined
  }

  return parseAgentWorkflowSnapshot(value, {
    taskId: launch.taskId,
    runId: launch.runId,
    ...(launch.workflowName ? { workflowName: launch.workflowName } : {})
  })
}
