const { createHash, randomUUID } = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const SCHEMA = 1
const digest = (value) => createHash('sha256').update(value).digest('hex')

function inventory(root) {
  const files = []
  function visit(relative) {
    const filename = path.join(root, relative)
    const stat = fs.lstatSync(filename)
    if (stat.isDirectory()) {
      files.push([relative, 'directory', stat.mode & 0o777])
      for (const name of fs.readdirSync(filename).sort()) visit(path.posix.join(relative, name))
    } else if (stat.isFile()) {
      files.push([relative, digest(fs.readFileSync(filename)), stat.mode & 0o777])
    } else {
      throw new Error(`Build cache requires regular files: ${relative}`)
    }
  }
  visit('')
  return files
}

function createTask({ root, name, inputs, outputs, identity, cacheRoot = path.join(root, '.cache/release-build') }) {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error('Invalid build task name')
  for (const output of outputs) {
    if (path.isAbsolute(output) || output.split(/[\\/]/).includes('..') || !output) {
      throw new Error('Build task outputs must stay inside the project')
    }
  }
  const source = [...new Set(inputs)].sort().map((input) => {
    const filename = path.resolve(root, input)
    return [input, fs.existsSync(filename) ? inventory(filename) : null]
  })
  const key = digest(JSON.stringify({ schema: SCHEMA, name, source, outputs, identity }))
  return { root, name, key, inputs, outputs, identity, cacheRoot, directory: path.join(cacheRoot, name, key) }
}

function restoreTask(task) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(task.directory, 'manifest.json'), 'utf8'))
    if (manifest.key !== task.key || manifest.schema !== SCHEMA) return false
    const stored = path.join(task.directory, 'outputs')
    if (JSON.stringify(inventory(stored)) !== JSON.stringify(manifest.files)) return false
    if (
      JSON.stringify(fs.readdirSync(stored).sort()) !==
      JSON.stringify(task.outputs.map((_, index) => String(index)).sort())
    )
      return false
    for (const [index, output] of task.outputs.entries()) {
      const destination = path.join(task.root, output)
      fs.rmSync(destination, { recursive: true, force: true })
      fs.mkdirSync(path.dirname(destination), { recursive: true })
      fs.cpSync(path.join(stored, String(index)), destination, { recursive: true })
    }
    return true
  } catch {
    return false
  }
}

function saveTask(task) {
  if (createTask(task).key !== task.key) throw new Error('Build inputs changed during compilation')
  const temporary = `${task.directory}.${randomUUID()}.tmp`
  try {
    const stored = path.join(temporary, 'outputs')
    fs.mkdirSync(stored, { recursive: true })
    for (const [index, output] of task.outputs.entries()) {
      const source = path.join(task.root, output)
      inventory(source)
      fs.cpSync(source, path.join(stored, String(index)), { recursive: true })
    }
    fs.writeFileSync(
      path.join(temporary, 'manifest.json'),
      JSON.stringify({
        schema: SCHEMA,
        identity: task.identity,
        key: task.key,
        sourceSha: process.env.RELEASE_SHA || null,
        workflowSha: process.env.WORKFLOW_SHA || process.env.GITHUB_SHA || null,
        runId: process.env.GITHUB_RUN_ID || null,
        files: inventory(stored)
      })
    )
    fs.rmSync(task.directory, { recursive: true, force: true })
    fs.renameSync(temporary, task.directory)
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

function recordTiming(root, stage, start, result, key) {
  try {
    const directory = path.join(root, '.cache/release-build-metrics')
    fs.mkdirSync(directory, { recursive: true })
    fs.appendFileSync(
      path.join(directory, `${process.pid}.jsonl`),
      `${JSON.stringify({
        stage,
        seconds: (performance.now() - start) / 1000,
        result,
        key,
        sourceSha: process.env.RELEASE_SHA || null,
        workflowSha: process.env.WORKFLOW_SHA || process.env.GITHUB_SHA || null,
        runId: process.env.GITHUB_RUN_ID || null,
        attempt: process.env.GITHUB_RUN_ATTEMPT || null,
        platform: process.platform,
        arch: process.arch,
        node: process.version,
        image: process.env.ImageVersion || null,
        edition: process.env.CHERRY_EDITION || 'global'
      })}\n`
    )
  } catch {
    process.stderr.write(`Could not record build timing for ${stage}\n`)
  }
}

module.exports = { createTask, restoreTask, saveTask, recordTiming }
