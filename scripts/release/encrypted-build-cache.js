const { createCipheriv, createDecipheriv, hkdfSync, randomBytes, randomUUID } = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { pipeline } = require('node:stream/promises')
const tar = require('tar')
const { restoreTask, saveTask } = require('./build-cache')

const HEADER = Buffer.from('CHERRY01')
const IV_LENGTH = 12
const TAG_LENGTH = 16

function encryptionKey(env = process.env) {
  return /^[a-f0-9]{64}$/i.test(env.CHERRY_BUILD_CACHE_KEY || '')
    ? Buffer.from(env.CHERRY_BUILD_CACHE_KEY, 'hex')
    : null
}

async function saveEncryptedTask(task, key) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-build-cache-'))
  const archive = `${task.directory}.${randomUUID()}.tmp`
  try {
    const localTask = { ...task, directory: path.join(temporary, 'entry') }
    saveTask(localTask)
    const iv = randomBytes(IV_LENGTH)
    const cipher = createCipheriv('aes-256-gcm', hkdfSync('sha256', key, '', 'cherry-build-cache-v1', 32), iv)
    cipher.setAAD(Buffer.from(task.key))
    fs.mkdirSync(path.dirname(archive), { recursive: true })
    fs.writeFileSync(archive, Buffer.concat([HEADER, iv]), { mode: 0o600, flag: 'wx' })
    await pipeline(
      tar.c({ cwd: localTask.directory, gzip: true }, ['manifest.json', 'outputs']),
      cipher,
      fs.createWriteStream(archive, { flags: 'a' })
    )
    fs.appendFileSync(archive, cipher.getAuthTag())
    fs.renameSync(archive, `${task.directory}.bin`)
  } finally {
    fs.rmSync(archive, { force: true })
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

async function restoreEncryptedTask(task, key) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-build-cache-'))
  try {
    const archive = `${task.directory}.bin`
    const size = fs.statSync(archive).size
    const header = Buffer.alloc(HEADER.length + IV_LENGTH)
    const tag = Buffer.alloc(TAG_LENGTH)
    const fd = fs.openSync(archive, 'r')
    try {
      fs.readSync(fd, header, 0, header.length, 0)
      fs.readSync(fd, tag, 0, tag.length, size - tag.length)
    } finally {
      fs.closeSync(fd)
    }
    if (!header.subarray(0, HEADER.length).equals(HEADER)) return false
    const decipher = createDecipheriv(
      'aes-256-gcm',
      hkdfSync('sha256', key, '', 'cherry-build-cache-v1', 32),
      header.subarray(HEADER.length)
    )
    decipher.setAAD(Buffer.from(task.key))
    decipher.setAuthTag(tag)
    const decrypted = path.join(temporary, 'entry.tgz')
    // Do not extract or restore any bytes until GCM authentication succeeds.
    await pipeline(
      fs.createReadStream(archive, { start: header.length, end: size - TAG_LENGTH - 1 }),
      decipher,
      fs.createWriteStream(decrypted, { mode: 0o600 })
    )
    const directory = path.join(temporary, 'entry')
    fs.mkdirSync(directory)
    await pipeline(
      fs.createReadStream(decrypted),
      tar.x({
        cwd: directory,
        strict: true,
        filter: (_, entry) => entry.type === 'File' || entry.type === 'Directory'
      })
    )
    return restoreTask({ ...task, directory })
  } catch {
    return false
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true })
  }
}

module.exports = { encryptionKey, restoreEncryptedTask, saveEncryptedTask }
