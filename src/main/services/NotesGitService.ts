// 笔记本地 Git 服务：监听设置与路径变化，自动初始化仓库并定时提交。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { loggerService } from '@logger'
import { isPathInside } from '@main/utils/file'
import { findCommandInShellEnv } from '@main/utils/process'
import getLoginShellEnvironment from '@main/utils/shell-env'

import { reduxService } from './ReduxService'

const logger = loggerService.withContext('NotesGitService')

const DEFAULT_COMMIT_INTERVAL_MINUTES = 5
const COMMIT_INTERVAL_OPTIONS = [1, 5, 10, 30, 60] as const
const COMMIT_INTERVAL_OPTIONS_SET = new Set<number>(COMMIT_INTERVAL_OPTIONS)
const AUTO_COMMIT_FALLBACK_INTERVAL_MS = DEFAULT_COMMIT_INTERVAL_MINUTES * 60 * 1000
const MAX_DIFF_OUTPUT_SIZE = 1024 * 1024
const DEFAULT_GIT_USER_NAME = 'Cherry Studio'
const DEFAULT_GIT_USER_EMAIL = 'notes@cherry-studio.local'

export type GitCommandResult = {
  code: number | null
  stdout: string
  stderr: string
}

export function formatGitTimestamp(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  const year = date.getFullYear()
  const month = pad(date.getMonth() + 1)
  const day = pad(date.getDate())
  const hours = pad(date.getHours())
  const minutes = pad(date.getMinutes())
  const seconds = pad(date.getSeconds())
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
}

export class NotesGitService {
  private notesPath = ''
  private enableGit = false
  private commitIntervalMinutes = DEFAULT_COMMIT_INTERVAL_MINUTES
  private commitTimer?: NodeJS.Timeout
  private isCommitting = false
  private gitCommand?: string
  private shellEnv?: Record<string, string>
  private unsubscribeEnable?: () => void
  private unsubscribePath?: () => void
  private unsubscribeInterval?: () => void

  public async start(): Promise<void> {
    await this.loadInitialState()
    await this.applyState()

    this.unsubscribeEnable = await reduxService.subscribe('state.note.settings.enableGit', async (value) => {
      const nextValue = Boolean(value)
      if (nextValue === this.enableGit) {
        return
      }
      this.enableGit = nextValue
      await this.applyState()
    })

    this.unsubscribePath = await reduxService.subscribe('state.note.notesPath', async (value) => {
      const nextValue = typeof value === 'string' ? value : ''
      if (nextValue === this.notesPath) {
        return
      }
      this.notesPath = nextValue
      await this.applyState()
    })

    this.unsubscribeInterval = await reduxService.subscribe(
      'state.note.settings.gitCommitIntervalMinutes',
      async (value) => {
        const nextValue = this.normalizeCommitInterval(value)
        if (nextValue === this.commitIntervalMinutes) {
          return
        }
        this.commitIntervalMinutes = nextValue
        await this.applyState()
      }
    )
  }

  public stop(): void {
    this.stopTimer()
    this.unsubscribeEnable?.()
    this.unsubscribePath?.()
    this.unsubscribeInterval?.()
  }

  private async loadInitialState(): Promise<void> {
    const settings = await reduxService.select('state.note.settings')
    const notesPath = await reduxService.select('state.note.notesPath')
    this.enableGit = Boolean(settings?.enableGit)
    this.notesPath = typeof notesPath === 'string' ? notesPath : ''
    this.commitIntervalMinutes = this.normalizeCommitInterval(settings?.gitCommitIntervalMinutes)
  }

  private async applyState(): Promise<void> {
    this.stopTimer()

    if (!this.enableGit) {
      return
    }

    if (!this.notesPath) {
      logger.warn('Notes path is empty, Git service will stay idle')
      return
    }

    const ready = await this.prepareRepository(this.notesPath)
    if (!ready) {
      return
    }

    this.startTimer()
  }

  private startTimer(): void {
    if (this.commitTimer) {
      return
    }
    const intervalMs =
      this.commitIntervalMinutes > 0 ? this.commitIntervalMinutes * 60 * 1000 : AUTO_COMMIT_FALLBACK_INTERVAL_MS
    this.commitTimer = setInterval(() => {
      void this.runAutoCommit()
    }, intervalMs)
  }

  private stopTimer(): void {
    if (this.commitTimer) {
      clearInterval(this.commitTimer)
      this.commitTimer = undefined
    }
  }

  private async runAutoCommit(): Promise<void> {
    if (!this.enableGit || !this.notesPath) {
      return
    }
    if (this.isCommitting) {
      return
    }

    this.isCommitting = true
    try {
      await this.commitIfNeeded(this.notesPath)
    } finally {
      this.isCommitting = false
    }
  }

  private async prepareRepository(notesPath: string): Promise<boolean> {
    if (!fs.existsSync(notesPath)) {
      logger.warn('Notes path does not exist, skip Git initialization', { notesPath })
      return false
    }
    if (!fs.statSync(notesPath).isDirectory()) {
      logger.warn('Notes path is not a directory, skip Git initialization', { notesPath })
      return false
    }

    const gitAvailable = await this.ensureGitAvailable(notesPath)
    if (!gitAvailable) {
      return false
    }

    const initialized = await this.ensureRepositoryInitialized(notesPath)
    if (!initialized) {
      return false
    }

    await this.ensureGitUserConfig(notesPath)
    await this.commitIfNeeded(notesPath)
    return true
  }

  public async getStatus(notesPath: string): Promise<{ available: boolean; reason?: string }> {
    if (!notesPath) {
      return { available: false, reason: 'notes_path_missing' }
    }
    if (!fs.existsSync(notesPath) || !fs.statSync(notesPath).isDirectory()) {
      return { available: false, reason: 'notes_path_invalid' }
    }
    const result = await this.runGitCommand(['--version'], notesPath)
    if (result.code !== 0) {
      return { available: false, reason: 'git_not_found' }
    }
    return { available: true }
  }

  public async getFileHistory(
    notesPath: string,
    filePath: string
  ): Promise<Array<{ hash: string; date: string; message: string }>> {
    const relativePath = this.getSafeRelativePath(notesPath, filePath)
    if (!relativePath) {
      return []
    }

    const result = await this.runGitCommand(
      ['log', '--pretty=format:%H|%ad|%s', '--date=iso', '--', relativePath],
      notesPath
    )
    if (result.code !== 0) {
      return []
    }

    return result.stdout
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [hash, date, ...messageParts] = line.split('|')
        return {
          hash: hash ?? '',
          date: date ?? '',
          message: messageParts.join('|')
        }
      })
      .filter((item) => item.hash)
  }

  public async getFileDiff(
    notesPath: string,
    filePath: string,
    commitHash: string
  ): Promise<{ diff: string; truncated: boolean }> {
    const relativePath = this.getSafeRelativePath(notesPath, filePath)
    if (!relativePath || !commitHash) {
      return { diff: '', truncated: false }
    }

    const result = await this.runGitCommand(['diff', commitHash, '--', relativePath], notesPath)
    if (result.code !== 0) {
      return { diff: '', truncated: false }
    }

    const diff = result.stdout
    if (diff.length > MAX_DIFF_OUTPUT_SIZE) {
      return { diff: diff.slice(0, MAX_DIFF_OUTPUT_SIZE), truncated: true }
    }

    return { diff, truncated: false }
  }

  private async ensureGitAvailable(notesPath: string): Promise<boolean> {
    const result = await this.runGitCommand(['--version'], notesPath)
    if (result.code !== 0) {
      logger.warn('Git command is not available, skip notes git service', {
        notesPath,
        stderr: result.stderr.trim()
      })
      return false
    }
    return true
  }

  private async ensureRepositoryInitialized(notesPath: string): Promise<boolean> {
    const gitDir = path.join(notesPath, '.git')
    if (fs.existsSync(gitDir)) {
      return true
    }

    const result = await this.runGitCommand(['init'], notesPath)
    if (result.code !== 0) {
      logger.warn('Failed to initialize notes git repository', {
        notesPath,
        stderr: result.stderr.trim()
      })
      return false
    }
    return true
  }

  private async ensureGitUserConfig(notesPath: string): Promise<void> {
    await this.ensureGitConfig(notesPath, 'user.name', DEFAULT_GIT_USER_NAME)
    await this.ensureGitConfig(notesPath, 'user.email', DEFAULT_GIT_USER_EMAIL)
  }

  private async ensureGitConfig(notesPath: string, key: string, value: string): Promise<void> {
    const current = await this.runGitCommand(['config', '--get', key], notesPath)
    if (current.code === 0 && current.stdout.trim()) {
      return
    }

    const result = await this.runGitCommand(['config', key, value], notesPath)
    if (result.code !== 0) {
      logger.warn('Failed to set git config for notes repository', {
        notesPath,
        key,
        stderr: result.stderr.trim()
      })
    }
  }

  protected async commitIfNeeded(notesPath: string): Promise<boolean> {
    const status = await this.runGitCommand(['status', '--porcelain'], notesPath)
    if (status.code !== 0) {
      logger.warn('Failed to check git status for notes repository', {
        notesPath,
        stderr: status.stderr.trim()
      })
      return false
    }

    if (!status.stdout.trim()) {
      return false
    }

    const addResult = await this.runGitCommand(['add', '-A'], notesPath)
    if (addResult.code !== 0) {
      logger.warn('Failed to stage notes changes', {
        notesPath,
        stderr: addResult.stderr.trim()
      })
      return false
    }

    const message = formatGitTimestamp(new Date())
    const commitResult = await this.runGitCommand(['commit', '-m', message], notesPath)
    if (commitResult.code !== 0) {
      logger.warn('Failed to commit notes changes', {
        notesPath,
        stderr: commitResult.stderr.trim()
      })
      return false
    }

    return true
  }

  protected async runGitCommand(args: string[], cwd: string): Promise<GitCommandResult> {
    const command = await this.resolveGitCommand()
    const env = await this.getShellEnv()

    return new Promise((resolve) => {
      const child = spawn(command, args, {
        cwd,
        env,
        stdio: ['ignore', 'pipe', 'pipe']
      })

      let stdout = ''
      let stderr = ''

      child.stdout.on('data', (data) => {
        stdout += data.toString()
      })

      child.stderr.on('data', (data) => {
        stderr += data.toString()
      })

      child.on('error', (error) => {
        resolve({ code: null, stdout, stderr: `${stderr}\n${error.message}`.trim() })
      })

      child.on('close', (code) => {
        resolve({ code, stdout, stderr })
      })
    })
  }

  private async resolveGitCommand(): Promise<string> {
    if (this.gitCommand) {
      return this.gitCommand
    }

    const env = await this.getShellEnv()
    const resolved = await findCommandInShellEnv('git', env)
    this.gitCommand = resolved ?? 'git'
    return this.gitCommand
  }

  private async getShellEnv(): Promise<Record<string, string>> {
    if (this.shellEnv) {
      return this.shellEnv
    }

    try {
      this.shellEnv = await getLoginShellEnvironment()
    } catch (error) {
      logger.warn('Failed to load login shell environment, fallback to process env', error as Error)
      this.shellEnv = Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
      )
    }

    return this.shellEnv
  }

  private normalizeCommitInterval(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      return DEFAULT_COMMIT_INTERVAL_MINUTES
    }
    if (!COMMIT_INTERVAL_OPTIONS_SET.has(value)) {
      return DEFAULT_COMMIT_INTERVAL_MINUTES
    }
    return value
  }

  private getSafeRelativePath(notesPath: string, filePath: string): string | null {
    if (!filePath) {
      return null
    }
    const resolvedNotesPath = path.resolve(notesPath)
    const resolvedFilePath = path.resolve(filePath)
    if (!isPathInside(resolvedFilePath, resolvedNotesPath) || resolvedFilePath === resolvedNotesPath) {
      return null
    }
    const relativePath = path.relative(resolvedNotesPath, resolvedFilePath)
    return relativePath || null
  }
}

const notesGitService = new NotesGitService()

export default notesGitService
