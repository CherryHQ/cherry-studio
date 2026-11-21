import { type ChildProcess } from 'node:child_process'
import { randomUUID, createHash } from 'node:crypto'
import { appendFile, mkdir } from 'node:fs/promises'
import path from 'node:path'

import { application } from '@application'
import { agentGlobalSkillService } from '@data/services/AgentGlobalSkillService'
import { crossPlatformSpawn, terminateProcessTree } from '@main/utils/processRunner'
import { getShellEnv } from '@main/utils/shellEnv'
import type { SkillReadiness, SkillSetupPlan } from '@shared/types/skillReadiness'

import { inspectSkillEnvironment, managedSkillPython, validateSetupRequirements } from './skillEnvironment'

const PLAN_TTL_MS = 5 * 60_000
const SETUP_TIMEOUT_MS = 5 * 60_000
const LOG_LIMIT_BYTES = 2 * 1024 * 1024
interface ApprovedPlan {
  plan: SkillSetupPlan
  fingerprint: string
  skillContentHash: string
}

export class SkillSetupService {
  private plans = new Map<string, ApprovedPlan>()
  private active = new Map<string, { controller: AbortController; promise: Promise<SkillReadiness> }>()

  private resolveSkill(skillId: string) {
    const skill = agentGlobalSkillService.getById(skillId)
    if (!skill) throw new Error('Skill not found')
    const root = path.resolve(application.getPath('feature.agents.skills'))
    const directory = path.resolve(root, skill.folderName)
    if (path.dirname(directory) !== root) throw new Error('Invalid Skill directory')
    return { skill, directory }
  }

  private environmentDirectory(skillId: string, pythonPath?: string): string | undefined {
    if (!pythonPath) return undefined
    const root = path.resolve(
      application.getPath('feature.agents.skills.setup'),
      createHash('sha256').update(skillId).digest('hex')
    )
    const relative = path.relative(root, pythonPath)
    if (relative.startsWith('..') || path.isAbsolute(relative)) return undefined
    return path.dirname(path.dirname(path.dirname(pythonPath)))
  }

  private save(skillId: string, readiness: SkillReadiness): SkillReadiness {
    if (!agentGlobalSkillService.getById(skillId)) throw new Error('Skill was removed')
    const previous = agentGlobalSkillService.getById(skillId)?.readiness
    if (
      previous &&
      JSON.stringify({ ...previous, checkedAt: undefined }) === JSON.stringify({ ...readiness, checkedAt: undefined })
    )
      return previous
    agentGlobalSkillService.update(skillId, { readiness })
    agentGlobalSkillService.notifySkillProjectionChange(skillId)
    return readiness
  }

  async preflight(skillId: string): Promise<SkillReadiness> {
    const { skill, directory } = this.resolveSkill(skillId)
    if (this.active.has(skillId))
      return {
        ...(skill.readiness ?? { missing: [], fingerprint: '', checkedAt: new Date().toISOString() }),
        state: 'setting_up'
      }
    const environmentDirectory = this.environmentDirectory(skillId, skill.readiness?.pythonPath)
    const result = await inspectSkillEnvironment(directory, environmentDirectory)
    if (this.active.has(skillId))
      return {
        ...(this.resolveSkill(skillId).skill.readiness ?? {
          missing: [],
          fingerprint: '',
          checkedAt: new Date().toISOString()
        }),
        state: 'setting_up'
      }
    const previous = this.resolveSkill(skillId).skill.readiness
    const interrupted = previous?.state === 'setting_up' && !this.active.has(skillId)
    const failed = Boolean(result.requires) && (previous?.state === 'failed' || interrupted)
    return this.save(skillId, {
      state: failed ? 'failed' : result.state,
      missing: result.missing,
      warnings: result.warnings,
      fingerprint: result.fingerprint,
      checkedAt: new Date().toISOString(),
      ...(previous?.logPath ? { logPath: previous.logPath } : {}),
      ...(environmentDirectory ? { pythonPath: managedSkillPython(environmentDirectory) } : {}),
      ...(failed
        ? { error: interrupted ? 'Setup was interrupted. Approve a new setup run to retry.' : previous?.error }
        : {})
    })
  }

  async assertReady(skillId: string): Promise<SkillReadiness> {
    const readiness = await this.preflight(skillId)
    if (readiness.state !== 'ready')
      throw new Error(
        `Skill setup required: ${readiness.missing.join(', ') || readiness.error || readiness.state}. Open Skill settings to review setup.`
      )
    return readiness
  }

  async prepare(skillId: string): Promise<SkillSetupPlan> {
    if (this.active.has(skillId)) throw new Error('Skill setup is already running')
    for (const [id, entry] of this.plans) if (Date.parse(entry.plan.expiresAt) < Date.now()) this.plans.delete(id)
    const { skill, directory } = this.resolveSkill(skillId)
    const inspection = await inspectSkillEnvironment(
      directory,
      this.environmentDirectory(skillId, skill.readiness?.pythonPath)
    )
    const packages = validateSetupRequirements(inspection.requires)
    if (!packages.length)
      throw new Error(
        `These prerequisites require manual setup: ${inspection.missing.join(', ') || 'no declared pip packages'}`
      )
    if (!inspection.snapshot.python) throw new Error('A compatible Python interpreter must be installed before setup')
    if (inspection.missing.some((item) => item.startsWith('platform ') || item.startsWith('python ')))
      throw new Error(inspection.missing.join(', '))
    const approvalId = randomUUID()
    const environment = path.join(
      application.getPath('feature.agents.skills.setup'),
      createHash('sha256').update(skillId).digest('hex'),
      approvalId
    )
    const plan: SkillSetupPlan = {
      approvalId,
      skillId,
      expiresAt: new Date(Date.now() + PLAN_TTL_MS).toISOString(),
      directory: environment,
      packages,
      commands: [
        { executable: inspection.snapshot.python.path, args: ['-I', '-m', 'venv', path.join(environment, 'venv')] },
        {
          executable: managedSkillPython(environment),
          args: [
            '-I',
            '-m',
            'pip',
            '--isolated',
            'install',
            '--no-input',
            '--disable-pip-version-check',
            '--no-cache-dir',
            ...packages
          ]
        }
      ],
      warnings: [
        'This run downloads packages and may execute package build code. Disk usage is not capped. This is environment isolation, not an operating-system sandbox; package code runs with your user permissions. Approval applies to this run only.',
        ...inspection.missing
          .filter((item) => item.startsWith('binary '))
          .map((item) => `${item} must be installed manually; pip setup cannot provide it.`)
      ]
    }
    for (const [id, entry] of this.plans) if (entry.plan.skillId === skillId) this.plans.delete(id)
    this.plans.set(approvalId, {
      plan,
      fingerprint: inspection.fingerprint,
      skillContentHash: inspection.snapshot.skillContentHash
    })
    return plan
  }

  async approve(skillId: string, approvalId: string): Promise<SkillReadiness> {
    const approved = this.plans.get(approvalId)
    if (!approved || approved.plan.skillId !== skillId || Date.parse(approved.plan.expiresAt) < Date.now())
      throw new Error('Setup approval expired. Review a new plan.')
    this.plans.delete(approvalId)
    if (this.active.has(skillId)) throw new Error('Skill setup is already running')
    const { skill, directory } = this.resolveSkill(skillId)
    const controller = new AbortController()
    // Reserve approval validation as well as execution so cancellation cannot race startup.
    const promise = (async () => {
      const inspection = await inspectSkillEnvironment(
        directory,
        this.environmentDirectory(skillId, skill.readiness?.pythonPath)
      )
      if (Date.parse(approved.plan.expiresAt) < Date.now())
        throw new Error('Setup approval expired. Review a new plan.')
      if (inspection.fingerprint !== approved.fingerprint)
        throw new Error('Skill or environment changed. Review a new setup plan.')
      return this.run(approved, controller)
    })().finally(() => this.active.delete(skillId))
    this.active.set(skillId, { controller, promise })
    return promise
  }

  cancel(skillId: string): void {
    this.active.get(skillId)?.controller.abort(new Error('Setup cancelled'))
    for (const [id, entry] of this.plans) if (entry.plan.skillId === skillId) this.plans.delete(id)
  }

  private async run(
    { plan, fingerprint, skillContentHash }: ApprovedPlan,
    controller: AbortController
  ): Promise<SkillReadiness> {
    const logPath = path.join(plan.directory, 'setup.log')
    const base: SkillReadiness = {
      state: 'setting_up',
      missing: [],
      fingerprint,
      checkedAt: new Date().toISOString(),
      logPath,
      pythonPath: managedSkillPython(plan.directory)
    }
    const timeout = setTimeout(
      () => controller.abort(new Error('Setup timed out after five minutes')),
      SETUP_TIMEOUT_MS
    )
    try {
      await mkdir(path.join(plan.directory, 'tmp'), { recursive: true })
      this.save(plan.skillId, base)
      for (const command of plan.commands) {
        controller.signal.throwIfAborted()
        await this.execute(command.executable, command.args, plan.directory, logPath, controller.signal)
      }
      controller.signal.throwIfAborted()
      const { directory } = this.resolveSkill(plan.skillId)
      const checked = await inspectSkillEnvironment(directory, plan.directory)
      controller.signal.throwIfAborted()
      if (checked.snapshot.skillContentHash !== skillContentHash)
        throw new Error('Skill changed during setup. Review a new setup run.')
      if (checked.state !== 'ready') throw new Error(`Prerequisites still missing: ${checked.missing.join(', ')}`)
      return this.save(plan.skillId, {
        ...base,
        state: 'ready',
        fingerprint: checked.fingerprint,
        checkedAt: new Date().toISOString()
      })
    } catch (error) {
      const message = controller.signal.aborted
        ? String(controller.signal.reason?.message ?? 'Setup cancelled')
        : error instanceof Error
          ? error.message
          : String(error)
      await appendFile(logPath, `\nSetup failed: ${message}\n`).catch(() => {})
      if (!agentGlobalSkillService.getById(plan.skillId)) throw new Error(message)
      return this.save(plan.skillId, {
        ...base,
        state: 'failed',
        error: message,
        missing: plan.packages.map((requirement) => `pip ${requirement}`),
        checkedAt: new Date().toISOString()
      })
    } finally {
      clearTimeout(timeout)
    }
  }

  private async execute(
    executable: string,
    args: string[],
    cwd: string,
    logPath: string,
    signal: AbortSignal
  ): Promise<void> {
    const env = { ...(await getShellEnv()) }
    for (const key of Object.keys(env)) if (/^(PYTHON|PIP|VIRTUAL_ENV)/i.test(key)) delete env[key]
    for (const key of ['TMPDIR', 'TEMP', 'TMP']) env[key] = path.join(cwd, 'tmp')
    await appendFile(logPath, `${JSON.stringify({ executable, args })}\n`)
    signal.throwIfAborted()
    return new Promise((resolve, reject) => {
      const child: ChildProcess = crossPlatformSpawn(executable, args, {
        cwd,
        env,
        detached: process.platform !== 'win32'
      })
      let bytes = 0
      let failed: Error | undefined
      let writes = Promise.resolve()
      const stop = () => {
        void terminateProcessTree(child, true, 'Skill setup').catch((error) => {
          failed = error
        })
      }
      const abort = () => {
        failed = new Error(String(signal.reason?.message ?? 'Setup cancelled'))
        stop()
      }
      signal.addEventListener('abort', abort, { once: true })
      if (signal.aborted) abort()
      const collect = (chunk: Buffer) => {
        bytes += chunk.byteLength
        if (bytes > LOG_LIMIT_BYTES) {
          failed = new Error('Setup log exceeded its two megabyte limit')
          stop()
          return
        }
        writes = writes
          .then(() => appendFile(logPath, chunk))
          .catch((error) => {
            failed = error
            stop()
          })
      }
      child.stdout?.on('data', collect)
      child.stderr?.on('data', collect)
      child.once('error', (error) => {
        failed = error
      })
      child.once('close', (code) => {
        signal.removeEventListener('abort', abort)
        void writes.then(
          () =>
            failed
              ? reject(failed)
              : code === 0
                ? resolve()
                : reject(new Error(`Setup command failed (${code}): ${executable}`)),
          reject
        )
      })
    })
  }
}

export const skillSetupService = new SkillSetupService()
