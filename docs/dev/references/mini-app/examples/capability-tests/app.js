// Runs every `window.cherry` capability against its documented contract (capabilities.md).
// Every permission this app declares is optional: what each call is EXPECTED to do is
// computed from `cherry.app.getPermissions()` at run time, so revoking a permission in
// Cherry and re-running a group tests that refusal path.

/* global cherry */

const KB = 1024
const MB = 1024 * KB
// Everything this app creates carries this prefix, so "clean up" can find it again.
const PREFIX = 'sbx.'
const ECHO = 'https://postman-echo.com'

const LABELS = {
  en: {
    title: 'Capability Tests',
    permissions: 'Permissions',
    permissionsHint:
      'Granted leaves in green. Revoke any of them on this app’s detail page in Cherry, then re-run a group: the refusal path is part of the contract.',
    refresh: 'Refresh',
    clearLog: 'Clear log',
    cleanup: 'Delete everything these tests created',
    storageRoundtrip: 'set / get / keys / delete',
    storageLimits: 'key and value limits',
    storageRate: 'write rate limit',
    storageFill: 'fill 1000 keys (~50 s)',
    fileRoundtrip: 'save / load / list / delete',
    fileLimits: 'name and size limits',
    fileQuota: '20 MB budget (~3 s)',
    fileCount: '200 files (~10 s)',
    fileExport: 'export via save dialog',
    aiBasics: 'capabilities / chat / both slots',
    aiCancel: 'cancel mid-stream',
    aiLimits: 'message limits / callId / in flight',
    notificationAll: 'show / truncation / 5 per minute',
    clipboardAll: 'write / read / focus rule / 30 and 10 per minute',
    networkBasics: 'GET / POST / headers / non-2xx',
    networkRefusals: 'what is refused',
    networkLimits: '5 MB cap and 4 in flight (~10 s)',
    sandboxAll: 'popups / navigation / web APIs'
  },
  zh: {
    title: '能力测试',
    permissions: '权限',
    permissionsHint: '绿色为已授予。在 Cherry 的详情页撤销任意一项后重跑对应分组：拒绝路径也是契约的一部分。',
    refresh: '刷新',
    clearLog: '清空日志',
    cleanup: '删除这些测试创建的全部数据',
    storageRoundtrip: 'set / get / keys / delete',
    storageLimits: '键和值的上限',
    storageRate: '写入频率限制',
    storageFill: '填满 1000 个键（约 50 秒）',
    fileRoundtrip: 'save / load / list / delete',
    fileLimits: '文件名和大小上限',
    fileQuota: '20 MB 总额（约 3 秒）',
    fileCount: '200 个文件（约 10 秒）',
    fileExport: '通过另存为对话框导出',
    aiBasics: 'capabilities / chat / 双槽位',
    aiCancel: '流式中途取消',
    aiLimits: '消息上限 / callId / 并发',
    notificationAll: 'show / 截断 / 每分钟 5 次',
    clipboardAll: 'write / read / 焦点规则 / 每分钟 30 与 10 次',
    networkBasics: 'GET / POST / 头 / 非 2xx',
    networkRefusals: '哪些会被拒绝',
    networkLimits: '5 MB 上限与 4 路并发（约 10 秒）',
    sandboxAll: '弹窗 / 导航 / Web API'
  }
}

const el = (id) => document.getElementById(id)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fmt = (bytes) =>
  bytes >= MB ? `${(bytes / MB).toFixed(2)} MB` : bytes >= KB ? `${(bytes / KB).toFixed(1)} KB` : `${bytes} B`

// base64 of `n` zero bytes without materializing them: 3 bytes per 4 characters, then the tail.
function zeroBase64(n) {
  const tail = ['', 'AA==', 'AAA='][n % 3]
  return 'A'.repeat(Math.floor(n / 3) * 4) + tail
}

function randomBase64(n) {
  const bytes = new Uint8Array(n)
  for (let i = 0; i < n; i += 65536) crypto.getRandomValues(bytes.subarray(i, Math.min(i + 65536, n)))
  let binary = ''
  for (let i = 0; i < n; i += 8192) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192))
  return btoa(binary)
}

const utf8ToBase64 = (text) => btoa(String.fromCharCode(...new TextEncoder().encode(text)))
const base64ToUtf8 = (data) => new TextDecoder().decode(Uint8Array.from(atob(data), (c) => c.charCodeAt(0)))

// ---- permissions ----

let perms = {}

/** What a call gated by `leaf` must do right now: succeed, or reject with PermissionDenied. */
const gate = (leaf) => (perms[leaf] ? 'ok' : 'PermissionDenied')
/** A namespace's `usage()` is open once ANY sibling is granted. */
const anyOf = (namespace) => Object.keys(perms).some((leaf) => leaf.startsWith(`${namespace}.`) && perms[leaf])

async function refreshPermissions() {
  perms = await cherry.app.getPermissions()
  el('permissions').replaceChildren(
    ...Object.entries(perms).map(([leaf, granted]) => {
      const item = document.createElement('li')
      item.className = granted ? 'granted' : 'denied'
      item.textContent = leaf
      return item
    })
  )
  await showUsage()
}

async function showUsage() {
  const part = async (namespace) => {
    if (!anyOf(namespace)) return `${namespace} —`
    const u = await cherry[namespace].usage()
    return `${namespace} ${fmt(u.bytes)} / ${fmt(u.bytesLimit)} · ${u.count} / ${u.countLimit}`
  }
  el('usage').textContent = `${await part('storage')}   ${await part('file')}`
}

// ---- reporting ----

let currentLine = null

function log(text, ok) {
  const item = document.createElement('li')
  item.textContent = text
  item.className = ok === undefined ? '' : ok ? 'pass' : 'fail'
  el('log').prepend(item)
  currentLine = item
  return item
}

// Rewrites the newest line in place, for long loops that would otherwise flood the log.
function progress(text) {
  if (currentLine) currentLine.textContent = text
}

// Runs `fn` and compares the outcome with `expected`: 'ok' for a resolve, else an error name.
async function expect(label, expected, fn) {
  try {
    const result = await fn()
    const detail = typeof result === 'string' ? ` — ${result}` : ''
    log(`${label}: ${expected === 'ok' ? 'ok' : `resolved, expected ${expected}`}${detail}`, expected === 'ok')
    return result
  } catch (error) {
    const got = `${error.name}: ${error.message}`
    log(`${label}: ${error.name === expected ? got : `${got} (expected ${expected})`}`, error.name === expected)
    return undefined
  }
}

// The limiter answers `RateLimited` to anything past 20 writes a second; a test that is
// about capacity, not rate, just waits its turn.
async function patient(fn) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn()
    } catch (error) {
      if (error.name !== 'RateLimited' || attempt >= 60) throw error
      await sleep(250)
    }
  }
}

const mismatch = (message) => ({ name: 'Mismatch', message })

// ---- storage ----

async function storageRoundtrip() {
  const key = `${PREFIX}roundtrip`
  const value = JSON.stringify({ hello: '世界', at: Date.now() })
  await expect(
    'get(missing)',
    gate('storage.get'),
    async () => `value=${(await cherry.storage.get(`${PREFIX}missing`)).value}`
  )
  await expect('set', gate('storage.set'), () => cherry.storage.set(key, value))
  await expect('get', gate('storage.get'), async () => {
    const got = (await cherry.storage.get(key)).value
    if (got !== value) throw mismatch(`read back ${got}`)
    return 'read back the same value'
  })
  await expect('keys', gate('storage.keys'), async () => {
    const { keys } = await cherry.storage.keys()
    if (!keys.includes(key)) throw mismatch(`keys=${keys.join(',')}`)
    return `${keys.length} keys, sorted: ${keys.every((k, i) => i === 0 || keys[i - 1] <= k)}`
  })
  await expect('delete', gate('storage.delete'), () => cherry.storage.delete(key))
  await expect('get(deleted)', gate('storage.get'), async () => {
    const got = (await cherry.storage.get(key)).value
    if (got !== null) throw mismatch(`still ${got}`)
    return 'value=null'
  })
  await expect('delete(again)', gate('storage.delete'), () => cherry.storage.delete(key))
}

async function storageLimits() {
  // 257 characters: refused inside the page, before the grant is even consulted.
  await expect('key of 257 chars', 'InvalidArgument', () => cherry.storage.set('k'.repeat(257), '1'))
  await expect('value of 1 MB + 1', 'InvalidArgument', () => cherry.storage.set(`${PREFIX}big`, 'x'.repeat(MB + 1)))
  const set = gate('storage.set')
  // 100 CJK characters pass the guest's character gate but weigh 300 bytes: the host refuses.
  await expect('key of 300 bytes', set === 'ok' ? 'InvalidArgument' : set, () =>
    cherry.storage.set('键'.repeat(100), '1')
  )
  // Exactly 1 MB fits the value gate but not the whole save file once its JSON framing is added.
  await expect('value of 1 MB', set === 'ok' ? 'QuotaExceeded' : set, () =>
    cherry.storage.set(`${PREFIX}big`, 'x'.repeat(MB))
  )
  await expect('value of 512 KB', set, () => patient(() => cherry.storage.set(`${PREFIX}big`, 'x'.repeat(512 * KB))))
  await expect('delete 512 KB', gate('storage.delete'), () => patient(() => cherry.storage.delete(`${PREFIX}big`)))
}

async function storageRate() {
  const results = await Promise.allSettled(
    Array.from({ length: 30 }, (_, i) => cherry.storage.set(`${PREFIX}rate.${i}`, '1'))
  )
  const count = (name) => results.filter((r) => r.status === 'rejected' && r.reason.name === name).length
  const ok = results.filter((r) => r.status === 'fulfilled').length
  if (gate('storage.set') !== 'ok') {
    log(
      `30 parallel sets without storage.set: ${count('PermissionDenied')} PermissionDenied`,
      count('PermissionDenied') === 30
    )
    return
  }
  const limited = count('RateLimited')
  log(
    `30 parallel sets: ${ok} ok, ${limited} RateLimited, ${30 - ok - limited} other`,
    limited > 0 && ok + limited === 30
  )
  for (let i = 0; i < 30; i++) await patient(() => cherry.storage.delete(`${PREFIX}rate.${i}`))
  log('rate keys deleted', true)
}

// Leaves the keys in place on purpose: clear data / uninstall in Cherry is the second half of this test.
async function storageFill() {
  if (gate('storage.set') !== 'ok') {
    await expect('set without storage.set', 'PermissionDenied', () => cherry.storage.set(`${PREFIX}fill.0000`, '1'))
    return
  }
  const before = (await cherry.storage.usage()).count
  log(`filling from ${before} keys…`)
  for (let i = 0; ; i++) {
    try {
      await patient(() => cherry.storage.set(`${PREFIX}fill.${String(i).padStart(4, '0')}`, '1'))
      if (i % 25 === 0) progress(`filling… ${before + i + 1} keys`)
    } catch (error) {
      const total = (await cherry.storage.usage()).count
      progress(`${error.name} at key ${before + i + 1}, file holds ${total}: ${error.message}`)
      currentLine.className = error.name === 'QuotaExceeded' && total === 1000 ? 'pass' : 'fail'
      return
    }
  }
}

// ---- file ----

async function fileRoundtrip() {
  const name = `${PREFIX}roundtrip.bin`
  const data = randomBase64(64 * KB)
  await expect(
    'load(missing)',
    gate('file.load'),
    async () => `data=${(await cherry.file.load(`${PREFIX}missing`)).data}`
  )
  await expect('save 64 KB', gate('file.save'), () => cherry.file.save(name, data))
  await expect('load', gate('file.load'), async () => {
    const got = (await cherry.file.load(name)).data
    if (got !== data) throw mismatch(`read back ${got?.length} chars`)
    return 'read back identical bytes'
  })
  await expect('save (overwrite)', gate('file.save'), () => cherry.file.save(name, randomBase64(1 * KB)))
  await expect('usage after overwrite', anyOf('file') ? 'ok' : 'PermissionDenied', async () => {
    const { bytes } = await cherry.file.usage()
    return `${fmt(bytes)} in total (the 64 KB were replaced, not added)`
  })
  await expect('list', gate('file.list'), async () => {
    const { names } = await cherry.file.list()
    if (perms['file.save'] && !names.includes(name)) throw mismatch(`names=${names.join(',')}`)
    return `${names.length} names`
  })
  await expect('delete', gate('file.delete'), () => cherry.file.delete(name))
  await expect('load(after delete)', gate('file.load'), async () => `data=${(await cherry.file.load(name)).data}`)
  await expect('delete(again)', gate('file.delete'), () => cherry.file.delete(name))
}

async function fileLimits() {
  const save = gate('file.save')
  const invalid = save === 'ok' ? 'InvalidArgument' : save
  await expect('name with /', invalid, () => cherry.file.save('a/b', 'AA=='))
  await expect('name with \\', invalid, () => cherry.file.save('a\\b', 'AA=='))
  await expect('name ..', invalid, () => cherry.file.save('..', 'AA=='))
  await expect('malformed base64', invalid, () => cherry.file.save(`${PREFIX}bad`, 'not base64!'))
  // Guest-side gates: refused before the grant is consulted.
  await expect('name of 129 chars', 'InvalidArgument', () => cherry.file.save('n'.repeat(129), 'AA=='))
  await expect('10 MB + 8 B', 'InvalidArgument', () => cherry.file.save(`${PREFIX}over`, zeroBase64(10 * MB + 8)))
}

// Saves ≤ 10 MB files until the 20 MB budget is exactly full, then one more byte.
async function fileQuota() {
  if (gate('file.save') !== 'ok') {
    await expect('save without file.save', 'PermissionDenied', () => cherry.file.save(`${PREFIX}quota.0`, 'AA=='))
    return
  }
  const saved = []
  for (let i = 0; ; i++) {
    const { bytes, bytesLimit } = await cherry.file.usage()
    const room = bytesLimit - bytes
    if (room <= 0) break
    const size = Math.min(10 * MB, room)
    const name = `${PREFIX}quota.${i}`
    const ok = await expect(`save ${fmt(size)}`, 'ok', () => patient(() => cherry.file.save(name, zeroBase64(size))))
    if (!ok) return
    saved.push(name)
  }
  await expect('save 1 B over budget', 'QuotaExceeded', () => cherry.file.save(`${PREFIX}quota.over`, 'AA=='))
  await showUsage()
  for (const name of saved)
    await expect(`delete ${name}`, gate('file.delete'), () => patient(() => cherry.file.delete(name)))
}

async function fileCount() {
  if (gate('file.save') !== 'ok') {
    await expect('save without file.save', 'PermissionDenied', () => cherry.file.save(`${PREFIX}count.000`, 'AA=='))
    return
  }
  const before = (await cherry.file.usage()).count
  const saved = []
  log(`filling from ${before} files…`)
  for (let i = 0; ; i++) {
    const name = `${PREFIX}count.${String(i).padStart(3, '0')}`
    try {
      await patient(() => cherry.file.save(name, 'AA=='))
      saved.push(name)
      if (i % 10 === 0) progress(`filling… ${before + i + 1} files`)
    } catch (error) {
      const total = (await cherry.file.usage()).count
      progress(`${error.name} at file ${before + i + 1}, sandbox holds ${total}: ${error.message}`)
      currentLine.className = error.name === 'QuotaExceeded' && total === 200 ? 'pass' : 'fail'
      break
    }
  }
  if (!perms['file.delete']) {
    log('file.delete not granted: the files stay for clear data / uninstall to remove', true)
    return
  }
  for (const [i, name] of saved.entries()) {
    await patient(() => cherry.file.delete(name))
    if (i % 10 === 0) progress(`deleting… ${saved.length - i} left`)
  }
  log(`${saved.length} files deleted`, true)
}

async function fileExport() {
  const g = gate('file.export')
  if (perms['file.save']) {
    const body = `Exported from ${document.title} at ${new Date().toISOString()}\n`
    await cherry.file.save(`${PREFIX}export.txt`, utf8ToBase64(body))
  } else if (g === 'ok') {
    log('file.save is needed to have something to export; grant it in Cherry', false)
    return
  }
  await expect('export(unknown name)', g === 'ok' ? 'InvalidArgument' : g, () => cherry.file.export(`${PREFIX}missing`))
  await expect('export(name with a separator)', g === 'ok' ? 'InvalidArgument' : g, () => cherry.file.export('a/b'))
  await expect('export → save dialog (save or cancel, both are fine)', g, async () => {
    const { saved } = await cherry.file.export(`${PREFIX}export.txt`, { suggestedName: 'capability-tests-export.txt' })
    return `saved: ${saved}`
  })
  if (g === 'ok') log('the dialog must carry this app’s name in its title and sit on Cherry’s window', true)
}

// ---- ai ----

let callSeq = 0
const nextCallId = () => `sbx-${++callSeq}`

/** One chat call, collecting the stream; resolves with what arrived and how the call settled. */
async function chat(params, callId = nextCallId()) {
  const chunks = []
  await cherry.ai.chat(params, { onChunk: (text) => chunks.push(text), callId })
  return { text: chunks.join(''), chunks: chunks.length }
}

async function aiBasics() {
  const g = gate('ai.chat')
  for (const model of ['default', 'quick']) {
    await expect(`getCapabilities(${model})`, g, async () => {
      const caps = await cherry.ai.getCapabilities({ model })
      return `reasoning=${caps.reasoning} contextWindow=${caps.contextWindow}`
    })
  }
  await expect('chat quick, reasoning off', g, async () => {
    const { text, chunks } = await chat({
      messages: [{ role: 'user', content: 'Reply with exactly the single word PONG.' }],
      model: 'quick',
      reasoning: 'off'
    })
    if (chunks === 0) throw mismatch('resolved ok but no chunk arrived')
    return `${chunks} chunks: ${JSON.stringify(text.trim().slice(0, 40))}`
  })
  await expect('chat default, reasoning on, system + history', g, async () => {
    const { text, chunks } = await chat({
      messages: [
        { role: 'system', content: 'You answer with one short sentence.' },
        { role: 'user', content: 'My name is Sandbox.' },
        { role: 'assistant', content: 'Nice to meet you, Sandbox.' },
        { role: 'user', content: 'What is my name?' }
      ],
      reasoning: 'on'
    })
    if (chunks === 0) throw mismatch('resolved ok but no chunk arrived')
    return `${chunks} chunks: ${JSON.stringify(text.trim().slice(0, 60))}`
  })
}

async function aiCancel() {
  const g = gate('ai.chat')
  await expect('cancel(unknown id)', 'ok', () => cherry.ai.cancel('never-started'))
  if (g !== 'ok') {
    await expect('chat without ai.chat', 'PermissionDenied', () =>
      chat({ messages: [{ role: 'user', content: 'hi' }] })
    )
    return
  }
  const callId = nextCallId()
  let arrived = 0
  let afterCancel = 0
  let cancelled = false
  const call = cherry.ai
    .chat(
      { messages: [{ role: 'user', content: 'Count from 1 to 500, one number per line.' }], model: 'quick' },
      {
        onChunk: () => {
          arrived++
          if (cancelled) afterCancel++
        },
        callId
      }
    )
    .then(
      () => 'resolved ok',
      (error) => `rejected ${error.name}`
    )
  // Cancel as soon as the stream is flowing, so the cancel provably interrupts something.
  for (let waited = 0; arrived === 0 && waited < 15000; waited += 100) await sleep(100)
  cancelled = true
  await cherry.ai.cancel(callId)
  const settled = await Promise.race([call, sleep(5000).then(() => 'still pending after 5 s')])
  await sleep(1500)
  const ok = arrived > 0 && afterCancel === 0 && settled !== 'still pending after 5 s'
  log(`cancel mid-stream: ${arrived} chunks before, ${afterCancel} after, call ${settled}`, ok)
}

async function aiLimits() {
  const g = gate('ai.chat')
  const one = { role: 'user', content: 'hi' }
  // Guest-side gates: refused before the grant is consulted.
  await expect('65 messages', 'InvalidArgument', () => chat({ messages: Array.from({ length: 65 }, () => one) }))
  await expect('content of 256 KB + 1', 'InvalidArgument', () =>
    chat({ messages: [{ role: 'user', content: 'x'.repeat(256 * KB + 1) }] })
  )
  await expect('callId of 65 chars', 'InvalidArgument', () => chat({ messages: [one] }, 'c'.repeat(65)))
  await expect('empty messages', g === 'ok' ? 'InvalidArgument' : g, () => chat({ messages: [] }))
  await expect('unknown role', g === 'ok' ? 'InvalidArgument' : g, () =>
    chat({ messages: [{ role: 'tool', content: 'x' }] })
  )
  if (g !== 'ok') return

  // Same callId twice while the first is in flight: the second must be refused, not merged.
  const id = nextCallId()
  const first = chat(
    { messages: [{ role: 'user', content: 'Count from 1 to 300, one per line.' }], model: 'quick' },
    id
  )
  await sleep(300)
  await expect('callId reused while in flight', 'InvalidArgument', () => chat({ messages: [one], model: 'quick' }, id))
  await cherry.ai.cancel(id)
  await first.catch(() => {})

  // Two in flight per app: a third must be RateLimited immediately, not queued.
  const ids = [nextCallId(), nextCallId(), nextCallId()]
  const long = { messages: [{ role: 'user', content: 'Count from 1 to 300, one per line.' }], model: 'quick' }
  const calls = ids.map((callId) =>
    chat(long, callId).then(
      () => 'ok',
      (error) => error.name
    )
  )
  await sleep(1500)
  for (const callId of ids) await cherry.ai.cancel(callId)
  const outcomes = await Promise.all(calls)
  const limited = outcomes.filter((o) => o === 'RateLimited').length
  log(`3 chats at once: ${outcomes.join(', ')}`, limited === 1)
}

// ---- notification ----

async function notificationAll() {
  const g = gate('notification.show')
  // Empty title is refused by the host's schema before the rate window is touched.
  await expect('empty title', g === 'ok' ? 'InvalidArgument' : g, () => cherry.notification.show({ title: '' }))
  const titles = [
    `${'T'.repeat(200)} (truncated to 64)`,
    ...Array.from({ length: 5 }, (_, i) => `Sandbox ${i + 2} of 6`)
  ]
  const outcomes = []
  for (const title of titles) {
    try {
      await cherry.notification.show({ title, body: 'B'.repeat(300) })
      outcomes.push('ok')
    } catch (error) {
      outcomes.push(error.name)
    }
  }
  const expected = g === 'ok' ? ['ok', 'ok', 'ok', 'ok', 'ok', 'RateLimited'] : Array(6).fill('PermissionDenied')
  log(`6 shows in a row: ${outcomes.join(', ')}`, JSON.stringify(outcomes) === JSON.stringify(expected))
  if (g === 'ok')
    log('(if Cherry’s mini app notifications are switched off, the calls still resolve ok and nothing is shown)')
}

// ---- clipboard ----

async function clipboardAll() {
  const w = gate('clipboard.write')
  const r = gate('clipboard.read')
  const marker = `${PREFIX}${Date.now()}`
  await expect('write (from a click, so the app is focused)', w, () => cherry.clipboard.write({ text: marker }))
  await expect('read returns what was written', r, async () => {
    const { text } = await cherry.clipboard.read()
    if (w === 'ok' && text !== marker) throw mismatch(`read "${text.slice(0, 40)}"`)
    return `"${text.slice(0, 40)}"`
  })
  await expect('write 1 MB + 1 — guest gate', 'InvalidArgument', () =>
    cherry.clipboard.write({ text: 'x'.repeat(MB + 1) })
  )
  if (w === 'ok') {
    const outcomes = []
    for (let i = 0; i < 31; i++) {
      try {
        await cherry.clipboard.write({ text: marker })
        outcomes.push('ok')
      } catch (error) {
        outcomes.push(error.name)
      }
    }
    // One write was spent above: 29 more fit in the minute, the last 2 must be refused.
    const pass = outcomes.slice(0, 29).every((o) => o === 'ok') && outcomes.slice(29).every((o) => o === 'RateLimited')
    log(`31 more writes: ${outcomes.filter((o) => o === 'ok').length} ok, then ${outcomes.slice(29).join(', ')}`, pass)
  }
  if (r === 'ok') {
    const outcomes = []
    for (let i = 0; i < 10; i++) {
      try {
        await cherry.clipboard.read()
        outcomes.push('ok')
      } catch (error) {
        outcomes.push(error.name)
      }
    }
    // One read was spent above: 9 more fit in the minute, the 10th must be refused.
    const pass = outcomes.slice(0, 9).every((o) => o === 'ok') && outcomes[9] === 'RateLimited'
    log(`10 more reads: ${outcomes.filter((o) => o === 'ok').length} ok, then ${outcomes[9]}`, pass)
  }
  // The host refuses both directions unless this app has keyboard focus. `document.hasFocus()`
  // is the guest's own view of that — the two must agree.
  log('focus rule: click into Cherry’s own UI (e.g. the sidebar) within 3 s…')
  await sleep(3000)
  const focused = document.hasFocus()
  const expected = w === 'ok' && !focused ? 'PermissionDenied' : w
  await expect(`write while ${focused ? 'focused' : 'NOT focused'}`, expected, () =>
    cherry.clipboard.write({ text: marker })
  )
}

// ---- network ----

const echoJson = (res) => JSON.parse(base64ToUtf8(res.body))

async function networkBasics() {
  const g = gate('network.fetch')
  await expect('GET', g, async () => {
    const res = await cherry.network.fetch({ url: `${ECHO}/get?probe=sandbox` })
    const echoed = echoJson(res)
    if (res.status !== 200 || echoed.args?.probe !== 'sandbox') {
      throw mismatch(`status ${res.status}, args ${JSON.stringify(echoed.args)}`)
    }
    const names = Object.keys(res.headers)
    if (names.some((n) => n !== n.toLowerCase())) throw mismatch(`header case: ${names}`)
    // The server does send one; it is the host's cookie jar, never the app's.
    if ('set-cookie' in res.headers) throw mismatch('set-cookie was forwarded')
    return `200, ${names.length} headers, lowercase, no set-cookie`
  })
  await expect('POST json + authorization', g, async () => {
    const res = await cherry.network.fetch({
      url: `${ECHO}/post`,
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: 'Bearer sandbox' },
      body: utf8ToBase64(JSON.stringify({ hello: '世界' }))
    })
    const echoed = echoJson(res)
    if (echoed.json?.hello !== '世界') throw mismatch(`echoed ${JSON.stringify(echoed.json)}`)
    if (echoed.headers?.authorization !== 'Bearer sandbox') {
      throw mismatch(`authorization arrived as ${echoed.headers?.authorization}`)
    }
    return 'body and authorization echoed back intact'
  })
  await expect('404 is a result', g, async () => {
    const res = await cherry.network.fetch({ url: `${ECHO}/status/404` })
    if (res.status !== 404) throw mismatch(`status ${res.status}`)
    return 'resolved with status 404'
  })
  await expect('HEAD', g, async () => {
    const res = await cherry.network.fetch({ url: `${ECHO}/get`, method: 'HEAD' })
    return `status ${res.status}, body ${res.body.length} chars`
  })
}

async function networkRefusals() {
  const g = gate('network.fetch')
  const denied = g === 'ok' ? 'PermissionDenied' : g
  const invalid = g === 'ok' ? 'InvalidArgument' : g
  await expect('undeclared host', denied, () => cherry.network.fetch({ url: 'https://example.com/' }))
  await expect('http://', denied, () => cherry.network.fetch({ url: 'http://postman-echo.com/get' }))
  await expect('non-default port', denied, () => cherry.network.fetch({ url: `${ECHO}:8443/get` }))
  await expect('IP literal', denied, () => cherry.network.fetch({ url: 'https://93.184.216.34/' }))
  await expect('cookie header', invalid, () => cherry.network.fetch({ url: `${ECHO}/get`, headers: { cookie: 'a=b' } }))
  await expect('host header', invalid, () => cherry.network.fetch({ url: `${ECHO}/get`, headers: { Host: 'evil' } }))
  await expect('method OPTIONS', invalid, () => cherry.network.fetch({ url: `${ECHO}/get`, method: 'OPTIONS' }))
  // Guest-side gates: refused before the grant is consulted.
  await expect('url of 2049 chars', 'InvalidArgument', () =>
    cherry.network.fetch({ url: `${ECHO}/get?${'x'.repeat(2049 - ECHO.length - 5)}` })
  )
  await expect('body of 1 MB + 8 B', 'InvalidArgument', () =>
    cherry.network.fetch({ url: `${ECHO}/post`, method: 'POST', body: zeroBase64(MB + 8) })
  )
  await expect('redirect', g === 'ok' ? 'Unavailable' : g, () =>
    cherry.network.fetch({ url: `${ECHO}/redirect-to?url=${encodeURIComponent(`${ECHO}/get`)}` })
  )
  // Informational: `localtest.me` resolves to 127.0.0.1 on a normal resolver and the host refuses
  // it (PermissionDenied). Behind a fake-ip proxy resolver the name looks public and the fetch
  // just fails downstream, so this line reports rather than judges.
  try {
    const res = await cherry.network.fetch({ url: 'https://localtest.me/' })
    log(`localtest.me (private-address guard): resolved with status ${res.status}`)
  } catch (error) {
    log(`localtest.me (private-address guard): ${error.name}: ${error.message}`)
  }
}

async function networkLimits() {
  const g = gate('network.fetch')
  const started = Date.now()
  await expect('48 MB file', g === 'ok' ? 'QuotaExceeded' : g, () =>
    cherry.network.fetch({ url: 'https://nodejs.org/dist/v24.0.0/node-v24.0.0-darwin-arm64.tar.gz' })
  )
  log(`(aborted after ${((Date.now() - started) / 1000).toFixed(1)} s — the body stops at the cap, not at the end)`)
  if (g !== 'ok') return
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () => cherry.network.fetch({ url: `${ECHO}/delay/3` }))
  )
  const ok = results.filter((r) => r.status === 'fulfilled' && r.value.status === 200).length
  const limited = results.filter((r) => r.status === 'rejected' && r.reason.name === 'RateLimited').length
  const other = results.filter((r) => r.status === 'rejected' && r.reason.name !== 'RateLimited')
  log(
    `6 parallel 3 s requests: ${ok} ok, ${limited} RateLimited, ${other.length} other${other[0] ? ` (${other[0].reason.name}: ${other[0].reason.message})` : ''}`,
    ok === 4 && limited === 2
  )
}

// ---- sandbox (needs no permission: what the page itself cannot do) ----

async function sandboxAll() {
  // `window.open` returns null when the host denies the popup; a non-null return is a window.
  const popup = window.open('https://example.com/', '_blank')
  log(`window.open(https) → ${popup === null ? 'null (denied)' : 'a window object'}`, popup === null)
  const sameApp = window.open(location.href, '_blank')
  log(`window.open(own origin) → ${sameApp === null ? 'null (denied)' : 'a window object'}`, sameApp === null)

  // A click on `<a target="_blank">` goes through the same handler.
  const anchor = document.createElement('a')
  anchor.href = 'https://example.com/'
  anchor.target = '_blank'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  log('<a target="_blank"> clicked — if a window or browser tab appeared, the sandbox leaked', true)

  // Top-level navigation off the app's origin is refused by `will-navigate`; the page stays.
  const before = location.href
  location.assign('https://example.com/')
  await sleep(1000)
  log(
    `location.assign(https) → still at ${location.href === before ? 'the app' : location.href}`,
    location.href === before
  )

  for (const [label, fn] of [
    ['localStorage', () => localStorage.getItem('x')],
    ['sessionStorage', () => sessionStorage.getItem('x')],
    ['indexedDB.open', () => indexedDB.open('x')]
  ]) {
    try {
      fn()
      log(`${label}: allowed`, false)
    } catch (error) {
      log(`${label}: ${error.name}`, error.name === 'SecurityError')
    }
  }
  await expect('fetch(https) from the page', 'TypeError', () => fetch('https://example.com/'))
  await expect('navigator.clipboard.writeText', 'NotAllowedError', () => navigator.clipboard.writeText('x'))
  await expect('Notification.requestPermission', 'ok', async () => `→ ${await Notification.requestPermission()}`)

  // Downloads are cancelled by the host: no save dialog may appear.
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob(['leak?'], { type: 'text/plain' }))
  link.download = 'capability-tests-leak.txt'
  document.body.appendChild(link)
  link.click()
  link.remove()
  await sleep(500)
  log('<a download> clicked — if a save dialog appeared, the sandbox leaked', true)

  // The File System Access pickers must reject; the exact name depends on user activation.
  for (const name of ['showOpenFilePicker', 'showSaveFilePicker', 'showDirectoryPicker']) {
    if (typeof window[name] !== 'function') {
      log(`${name}: not present`, true)
      continue
    }
    try {
      await window[name]()
      log(`${name}: resolved — a picker opened`, false)
    } catch (error) {
      log(`${name}: ${error.name}`, true)
    }
  }
  log('<input type="file"> and dropping a file onto this page are allowed: pick one to see name and size, never a path')
}

// ---- cleanup ----

async function cleanup() {
  if (perms['storage.keys'] && perms['storage.delete']) {
    const { keys } = await cherry.storage.keys()
    let removed = 0
    for (const key of keys) {
      if (!key.startsWith(PREFIX)) continue
      await patient(() => cherry.storage.delete(key))
      removed++
      if (removed % 25 === 0) progress(`deleting keys… ${removed}`)
    }
    log(`${removed} storage keys deleted`, true)
  } else {
    log('storage.keys + storage.delete needed to clean keys; grant them in Cherry or use clear data', false)
  }
  if (perms['file.list'] && perms['file.delete']) {
    const { names } = await cherry.file.list()
    let removed = 0
    for (const name of names) {
      if (!name.startsWith(PREFIX)) continue
      await patient(() => cherry.file.delete(name))
      removed++
    }
    log(`${removed} files deleted`, true)
  } else {
    log('file.list + file.delete needed to clean files; grant them in Cherry or use clear data', false)
  }
}

// ---- wiring ----

const TESTS = {
  'storage-roundtrip': ['storageRoundtrip', storageRoundtrip],
  'storage-limits': ['storageLimits', storageLimits],
  'storage-rate': ['storageRate', storageRate],
  'storage-fill': ['storageFill', storageFill],
  'file-roundtrip': ['fileRoundtrip', fileRoundtrip],
  'file-limits': ['fileLimits', fileLimits],
  'file-quota': ['fileQuota', fileQuota],
  'file-count': ['fileCount', fileCount],
  'file-export': ['fileExport', fileExport],
  'ai-basics': ['aiBasics', aiBasics],
  'ai-cancel': ['aiCancel', aiCancel],
  'ai-limits': ['aiLimits', aiLimits],
  'notification-all': ['notificationAll', notificationAll],
  'clipboard-all': ['clipboardAll', clipboardAll],
  'network-basics': ['networkBasics', networkBasics],
  'network-refusals': ['networkRefusals', networkRefusals],
  'network-limits': ['networkLimits', networkLimits],
  'sandbox-all': ['sandboxAll', sandboxAll],
  cleanup: ['cleanup', cleanup]
}

let running = false

async function run(id) {
  if (running) return
  running = true
  for (const button of document.querySelectorAll('button')) button.disabled = true
  const [labelKey, fn] = TESTS[id]
  // Permissions may have changed in Cherry since the last run; every expectation reads them fresh.
  await refreshPermissions()
  log(`▶ ${labelKey}`)
  const started = Date.now()
  try {
    await fn()
    log(`■ ${labelKey} done in ${((Date.now() - started) / 1000).toFixed(1)} s`)
  } catch (error) {
    log(`■ ${labelKey} aborted: ${error.name}: ${error.message}`, false)
  } finally {
    running = false
    for (const button of document.querySelectorAll('button')) button.disabled = false
    await showUsage().catch(() => {})
  }
}

function applyLocale(locale) {
  const labels = LABELS[locale] ?? LABELS[locale.split('-')[0]] ?? LABELS.en
  document.documentElement.lang = locale
  for (const node of document.querySelectorAll('[data-i18n]')) node.textContent = labels[node.dataset.i18n]
  for (const [id, [labelKey]] of Object.entries(TESTS)) el(id).textContent = labels[labelKey]
}

async function init() {
  const info = await cherry.app.getInfo()
  applyLocale(info.locale)
  el('app-info').textContent = `${info.appId} ${info.version} · Cherry ${info.hostVersion}`
  cherry.on('app.localeChange', ({ locale }) => applyLocale(locale))
  // Permissions only change while the host UI (which hides this app) is open.
  cherry.on('app.visibilityChange', ({ visible }) => visible && refreshPermissions())
  el('refresh-permissions').addEventListener('click', () => refreshPermissions())
  el('clear-log').addEventListener('click', () => el('log').replaceChildren())
  for (const id of Object.keys(TESTS)) el(id).addEventListener('click', () => run(id))
  const gotFile = (how, file) => file && log(`${how}: "${file.name}", ${fmt(file.size)}, no path`, true)
  el('sandbox-file').addEventListener('change', (event) => gotFile('<input type="file">', event.target.files[0]))
  document.addEventListener('dragover', (event) => event.preventDefault())
  document.addEventListener('drop', (event) => {
    event.preventDefault()
    gotFile('drop', event.dataTransfer.files[0])
  })
  await refreshPermissions()
}

init().catch((error) => log(`init failed: ${error.name}: ${error.message}`, false))
