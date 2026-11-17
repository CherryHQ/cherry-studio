import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import * as z from 'zod'

import { application } from '@application'
import { assertAgentStorageDirectory, assertAgentStoragePath } from '@main/ai/agents/agentDataDirectory'
import {
  digestRelocationArtifact as digest,
  relocationArtifactExists as exists
} from '@main/ai/agents/agentRelocationFiles'
import { atomicWriteFile } from '@main/utils/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

import { runForkWorker } from '../fork'
import {
  createRelocationHistoryReader,
  type RuntimeWorkspaceRelocation,
  type RelocatedCheckpoint
} from '../workspaceRelocation'
import type { RelocationWorkerInput } from './relocationWorker'

export const claudeWorkspaceRelocation: RuntimeWorkspaceRelocation = {
  ownsArtifact: (segments) =>
    segments[0] === '.claude' &&
    ((segments.length === 2 && segments[1] === '.claude.json') ||
      (segments.length === 3 && segments[1] === 'projects')),
  async prepare({ oldPath, newPath, oldDataRoot, directory, history: workspaceHistory, stage, assertAvailable }) {
    const history = workspaceHistory.filter((row) => (row.checkpoint?.runtime ?? row.runtime) === 'claude-code')
    const root = application.getPath('feature.agents.data')
    const oldConfig = path.join(oldDataRoot, '.claude')
    const newConfig = application.getPath('feature.agents.claude.root')
    const { default: createWorker } = await import('./relocationWorker?nodeWorker')
    const workerData: RelocationWorkerInput = { oldCwd: oldPath, newCwd: newPath }
    const result = z
      .strictObject({ oldKey: z.string(), newKey: z.string() })
      .parse(await runForkWorker(createWorker({ workerData, env: { ...process.env } }), new AbortController().signal))
    function projectPath(key: string) {
      if (!key || /[\\/]/.test(key) || key === '.' || key === '..') throw new Error('Invalid Claude project key')
      return path.join(newConfig, 'projects', key)
    }
    const oldProject = projectPath(result.oldKey)
    const newProject = projectPath(result.newKey)
    const readEntries = createRelocationHistoryReader(root)
    const configDirs = new Map<string, string>()
    for (const { sessionId, checkpoint } of history) {
      if (typeof checkpoint?.runtimeSessionId === 'string' && typeof checkpoint.configDir === 'string') {
        configDirs.set(`${sessionId}:${checkpoint.runtimeSessionId}`, checkpoint.configDir)
      }
    }
    const claudeHistory: Array<{ id: string; checkpoint: Record<string, unknown> | undefined }> = []
    const checkpoints: RelocatedCheckpoint[] = []
    for (const row of history) {
      const checkpoint = row.checkpoint
      if (row.messageId && checkpoint?.configDir === oldConfig) {
        checkpoints.push({ messageId: row.messageId, checkpoint: { ...checkpoint, configDir: newConfig } })
      }
      const id = checkpoint?.runtimeSessionId ?? row.resumeToken
      if (typeof id !== 'string') continue
      if (!z.uuid().safeParse(id).success) throw new Error('Invalid native session identity')
      const configDir = checkpoint?.configDir ?? configDirs.get(`${row.sessionId}:${id}`)
      if (!configDir || configDir === oldConfig) claudeHistory.push({ id, checkpoint })
    }
    const claudeProjects = new Set<string>()
    for (const { id } of claudeHistory) {
      let owner = oldProject
      await assertAgentStoragePath(root, owner)
      if (!(await exists(path.join(owner, id + '.jsonl')))) {
        // A stale literal project can outlive a removed symlink ancestor; resolve required identities before staging.
        const projectsRoot = path.dirname(oldProject)
        await assertAgentStorageDirectory(root, projectsRoot)
        const candidates: string[] = []
        for (const project of await readdir(projectsRoot, { withFileTypes: true })) {
          if (!project.isDirectory() || project.isSymbolicLink()) continue
          const candidate = projectPath(project.name)
          await assertAgentStoragePath(root, candidate)
          if (await exists(path.join(candidate, id + '.jsonl'))) candidates.push(candidate)
          if (candidates.length > 1) throw new Error('Ambiguous Claude project history')
        }
        if (candidates[0] === newProject) throw new Error('Relocation target already exists')
        if (!candidates.length) throw new Error('Claude history missing')
        owner = candidates[0]
      }
      claudeProjects.add(owner)
    }
    const [primaryProject = oldProject, ...additionalProjects] = claudeProjects
    let validationProject = primaryProject
    if (await exists(primaryProject)) {
      await digest(root, primaryProject)
      if (primaryProject !== newProject || additionalProjects.length) {
        validationProject = await stage([primaryProject, ...additionalProjects], newProject)
      }
    }
    for (const { id, checkpoint } of claudeHistory) {
      const file = path.join(validationProject, id + '.jsonl')
      await assertAgentStoragePath(root, file)
      if (!(await exists(file))) throw new Error('Claude history missing')
      const entries = await readEntries(file)
      if (
        !entries.some(
          (entry) => entry.sessionId === id && entry.uuid && (entry.type === 'user' || entry.type === 'assistant')
        )
      )
        throw new Error('Claude history corrupt')
      if (checkpoint?.messageUuid && !entries.some((entry) => entry.uuid === checkpoint.messageUuid))
        throw new Error('Claude checkpoint history missing')
    }
    const configFile = path.join(newConfig, '.claude.json')
    await assertAvailable(configFile)
    if (await exists(configFile)) {
      await digest(root, configFile)
      const config = JSON.parse(await readFile(configFile, 'utf8'))
      const projects = config.projects
      if (projects && typeof projects === 'object' && !Array.isArray(projects)) {
        const keys = Object.keys(projects).filter((key) => path.isAbsolute(key) && path.relative(key, oldPath) === '')
        if (keys.length > 1) throw new Error('Ambiguous Claude project configuration')
        if (keys.length) {
          if (Object.keys(projects).some((key) => path.isAbsolute(key) && path.relative(key, newPath) === ''))
            throw new Error('Claude project configuration conflict')
          projects[newPath] = projects[keys[0]]
          delete projects[keys[0]]
          const prepared = path.join(directory, 'config.json')
          await atomicWriteFile(AbsoluteFilePathSchema.parse(prepared), JSON.stringify(config), { mode: 0o600 })
          await stage([configFile], configFile, prepared)
        }
      }
    }
    return checkpoints
  }
}
