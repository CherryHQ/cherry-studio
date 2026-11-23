import { createHash, randomUUID } from 'node:crypto'
import { constants, realpathSync } from 'node:fs'
import { copyFile, lstat, mkdir, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { parentPort, workerData } from 'node:worker_threads'

export interface ClaudeRecoveryWorkerInput {
  configDir: string
  targetCwd: string
  sourceCwd: string
  nativeThreadId: string
}

async function run(input: ClaudeRecoveryWorkerInput) {
  if (!/^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(input.nativeThreadId)) {
    throw new Error('Invalid Claude session identity')
  }
  const { getSessionInfo, getSessionMessages } = await import('@anthropic-ai/claude-agent-sdk')
  const cwd = realpathSync(input.targetCwd)
  async function keyFor(dir: string) {
    let key: string | undefined
    await getSessionInfo(input.nativeThreadId, {
      dir,
      sessionStore: {
        async load(value) {
          key = value.projectKey
          return null
        },
        async append() {
          throw new Error('Unexpected Claude history write')
        }
      }
    })
    if (!key || /[\\/]/.test(key) || key === '.' || key === '..') throw new Error('Invalid Claude project key')
    return key
  }
  const projectKey = await keyFor(cwd)
  let sourceKey = await keyFor(input.sourceCwd)
  const projects = path.join(input.configDir, 'projects')
  async function regularTree(file: string): Promise<void> {
    const stat = await lstat(file)
    if (stat.isSymbolicLink()) throw new Error('Claude history contains a symbolic link')
    if (stat.isDirectory()) {
      for (const entry of await readdir(file)) await regularTree(path.join(file, entry))
    } else if (!stat.isFile()) throw new Error('Claude history is not a regular file')
  }
  async function digestTree(file: string): Promise<string> {
    const stat = await lstat(file)
    if (stat.isSymbolicLink()) throw new Error('Claude history contains a symbolic link')
    const hash = createHash('sha256')
    if (stat.isDirectory()) {
      for (const name of (await readdir(file)).sort()) hash.update(name).update(await digestTree(path.join(file, name)))
    } else if (stat.isFile()) hash.update(await readFile(file))
    else throw new Error('Claude history is not a regular file')
    return hash.digest('hex')
  }
  async function exists(file: string) {
    try {
      await lstat(file)
      return true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
      throw error
    }
  }
  async function copyChildren(source: string, target: string): Promise<void> {
    const sourceStat = await lstat(source)
    if (sourceStat.isSymbolicLink()) throw new Error('Claude history contains a symbolic link')
    if (sourceStat.isDirectory()) {
      if (await exists(target)) {
        const targetStat = await lstat(target)
        if (!targetStat.isDirectory() || targetStat.isSymbolicLink())
          throw new Error('Conflicting Claude child archive')
      } else await mkdir(target)
      for (const name of await readdir(source)) await copyChildren(path.join(source, name), path.join(target, name))
    } else if (sourceStat.isFile()) {
      if (await exists(target)) {
        await regularTree(target)
        if (!(await readFile(source)).equals(await readFile(target)))
          throw new Error('Conflicting Claude child archive')
      } else await copyFile(source, target, constants.COPYFILE_EXCL)
    } else throw new Error('Claude history is not a regular file')
  }
  const rootStat = await lstat(projects)
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error('Invalid Claude projects directory')
  const targetProject = path.join(projects, projectKey)
  const targetFile = path.join(targetProject, `${input.nativeThreadId}.jsonl`)
  if (await exists(targetProject)) {
    const stat = await lstat(targetProject)
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Invalid Claude target project')
  }
  // On retry the copied target already exists; recover the validated retained source key.
  if (await exists(targetFile)) {
    const hash = createHash('sha256').update(path.resolve(input.sourceCwd)).digest('hex')
    const record = path.join(input.configDir, '.cherry-workspace-recovery', `${input.nativeThreadId}.${hash}.json`)
    if (await exists(record)) {
      const stat = await lstat(record)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid Claude source recovery record')
      const saved = JSON.parse(await readFile(record, 'utf8'))
      if (
        saved.version !== 3 ||
        saved.sessionId !== input.nativeThreadId ||
        saved.cwd !== path.resolve(input.sourceCwd) ||
        typeof saved.projectKey !== 'string' ||
        !saved.projectKey ||
        /[\\/]/.test(saved.projectKey) ||
        ['.', '..'].includes(saved.projectKey)
      )
        throw new Error('Invalid Claude source recovery record')
      sourceKey = saved.projectKey
    }
  }
  const preferred = path.join(projects, sourceKey, `${input.nativeThreadId}.jsonl`)
  if (targetFile !== preferred && (await exists(targetFile)) && (await exists(preferred))) {
    await regularTree(preferred)
    await regularTree(targetFile)
    if (!(await readFile(preferred)).equals(await readFile(targetFile))) {
      throw new Error('Conflicting Claude history already exists at the replacement workspace')
    }
  }
  if (!(await exists(targetFile))) {
    const candidates: string[] = []
    if (await exists(preferred)) {
      candidates.push(preferred)
    } else {
      for (const project of await readdir(projects, { withFileTypes: true })) {
        if (!project.isDirectory()) continue
        const file = path.join(projects, project.name, `${input.nativeThreadId}.jsonl`)
        if (await exists(file)) candidates.push(file)
      }
    }
    if (candidates.length !== 1) throw new Error('Claude history is missing or ambiguous')
    const sourceFile = candidates[0]
    sourceKey = path.basename(path.dirname(sourceFile))
    const sourceProjectStat = await lstat(path.dirname(sourceFile))
    if (!sourceProjectStat.isDirectory() || sourceProjectStat.isSymbolicLink())
      throw new Error('Invalid Claude source project')
    await regularTree(sourceFile)
    const before = await readFile(sourceFile)
    const sourceChildren = path.join(path.dirname(sourceFile), input.nativeThreadId)
    const targetChildren = path.join(targetProject, input.nativeThreadId)
    // Copy only. The source is retained even if publication, validation or the later DB write fails.
    // Exclusive writes never replace existing history from another recovery or running session.
    await mkdir(targetProject, { recursive: true })
    if (await exists(sourceChildren)) {
      const childrenBefore = await digestTree(sourceChildren)
      await copyChildren(sourceChildren, targetChildren)
      if (
        childrenBefore !== (await digestTree(sourceChildren)) ||
        childrenBefore !== (await digestTree(targetChildren))
      ) {
        throw new Error('Claude child history changed during recovery')
      }
    }
    await copyFile(sourceFile, targetFile, constants.COPYFILE_EXCL)
    if (!before.equals(await readFile(sourceFile)) || !before.equals(await readFile(targetFile))) {
      throw new Error('Claude history changed during recovery')
    }
  }
  await regularTree(targetFile)
  // Use the same SDK lookup and message reader as the runtime archive adapter, from the new cwd.
  const info = await getSessionInfo(input.nativeThreadId, { dir: cwd })
  if (info?.sessionId !== input.nativeThreadId)
    throw new Error('Claude history cannot reopen from the replacement workspace')
  await getSessionMessages(input.nativeThreadId, { dir: cwd })
  // Fork must use this same verified archive, not reject the retained original as a duplicate.
  const records = path.join(input.configDir, '.cherry-workspace-recovery')
  await mkdir(records, { recursive: true })
  const recordsStat = await lstat(records)
  if (!recordsStat.isDirectory() || recordsStat.isSymbolicLink())
    throw new Error('Invalid Claude recovery record directory')
  async function publish(cwd: string, key: string, exclusive: boolean) {
    const resolved = path.resolve(cwd)
    const hash = createHash('sha256').update(resolved).digest('hex')
    const record = path.join(records, `${input.nativeThreadId}.${hash}.json`)
    const content = JSON.stringify({ version: 3, sessionId: input.nativeThreadId, cwd: resolved, projectKey: key })
    const temporary = path.join(records, `${input.nativeThreadId}.${randomUUID()}.tmp`)
    try {
      await writeFile(temporary, content, { flag: 'wx', mode: 0o600 })
      if (exclusive) {
        // mkdir is the no-replace primitive on portable profile volumes too. A crashed
        // publisher leaves a lock and fails closed rather than exposing a partial record.
        const lock = record + '.lock'
        await mkdir(lock)
        try {
          if (await exists(record)) {
            const stat = await lstat(record)
            if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid Claude source recovery record')
            const saved = JSON.parse(await readFile(record, 'utf8'))
            if (
              saved.version !== 3 ||
              saved.sessionId !== input.nativeThreadId ||
              saved.cwd !== resolved ||
              saved.projectKey !== key
            )
              throw new Error('Conflicting Claude source recovery record')
          } else await rename(temporary, record)
        } finally {
          await rm(lock, { recursive: true })
        }
      } else await rename(temporary, record)
    } finally {
      await rm(temporary, { force: true })
    }
  }
  // Separate workspace addresses prevent a losing A-to-C request from replacing B's mapping.
  // Never overwrite an earlier verified source address from another recovery.
  await publish(input.sourceCwd, sourceKey, true)
  await publish(input.targetCwd, projectKey, false)
  return { verified: true }
}

void run(workerData as ClaudeRecoveryWorkerInput).then(
  (result) => parentPort?.postMessage({ result }),
  (error) => parentPort?.postMessage({ error: error instanceof Error ? error.message : String(error) })
)
