import { idleDriverGeneration, keys } from '../core/keys'
import type { JobHandler, BoundPorts } from '../ports/harness'
import { check, rejects, same } from './assert'
import { append, key, latch, noticeTexts, read, step, transact } from './fixtures'
import type { ContractCase } from './harness'

export const durabilityCases: readonly ContractCase[] = [
  // Catches resume jobs that skip or repeat keyed steps, or abandon jobs that keep running or still count as live in onOpen (design §6.1 H4).
  {
    name: 'resume jobs rerun from the start after a restart; abandon jobs are dropped',
    covers: ['jobs.register', 'ledger.transact', 'lifecycle.register'],
    needs: ['restart'],
    async run(open) {
      let abandonLiveAtOpen: boolean | undefined
      const gates = { resume: latch(), abandon: latch() }
      const reached = { resume: latch(), abandon: latch() }
      const calls = { resume: 0, abandon: 0 }
      const job =
        (name: 'resume' | 'abandon'): JobHandler =>
        async (ports, spec) => {
          calls[name] += 1
          const once = (part: string) =>
            ports.ledger.transact(spec.scope, (f) =>
              step(
                f.keysSeen.has(key(`c16-${name}-${part}`))
                  ? []
                  : [append(spec.scope, `${name} ${part}`, `c16-${name}-${part}`)],
                null
              )
            )
          await once('a')
          reached[name].release()
          await gates[name].promise
          await once('b')
        }
      const h = await open((p) => {
        p.jobs.register('subagent-report', job('resume'))
        p.jobs.register('idle-driver', job('abandon'))
        p.lifecycle.register({
          async onOpen(thread, { reopened }, ports) {
            if (reopened) abandonLiveAtOpen = (await ports.ledger.read(thread)).keysSeen.has(key('c16-abandon'))
          },
          onCompacting: async () => ({ summary: 'summary' }),
          onCompacted: async () => {},
          onClose: async () => {}
        })
      })
      const t = await h.createThread()
      const ensure = (kind: 'subagent-report' | 'idle-driver', onRestart: 'resume' | 'abandon', label: string) =>
        transact(h, t, () =>
          step([{ type: 'ensure-job', job: { kind, scope: t, input: null, onRestart }, key: key(label) }], null)
        )
      await ensure('subagent-report', 'resume', 'c16-resume')
      await ensure('idle-driver', 'abandon', 'c16-abandon')
      await Promise.all([reached.resume.promise, reached.abandon.promise])
      await h.restart()
      check(abandonLiveAtOpen === false, 'an abandoned job must leave keysSeen from the reopen on, before onOpen')
      gates.resume.release()
      gates.abandon.release()
      await h.settle()
      same(
        noticeTexts(await read(h, t)).sort(),
        ['abandon a', 'resume a', 'resume b'],
        'keyed steps must apply once and an abandoned job must not continue'
      )
      same([calls.resume, calls.abandon], [2, 1], 'a resume job must rerun from the start; an abandon job must not')
      await ensure('idle-driver', 'abandon', 'c16-abandon')
      await h.settle()
      check(noticeTexts(await read(h, t)).includes('abandon b'), "an abandoned job's key must be usable again")
    }
  },
  // Catches a job table that keeps an ended job's key, so a later ensure under that key never runs (design §6.1 H4).
  {
    name: 'a job key is usable again once its job has ended',
    covers: ['jobs.register', 'ledger.transact'],
    needs: [],
    async run(open) {
      let runs = 0
      const h = await open((p) =>
        p.jobs.register('subagent-report', async () => {
          runs += 1
        })
      )
      const t = await h.createThread()
      const ensure = () =>
        transact(h, t, () =>
          step(
            [
              {
                type: 'ensure-job',
                job: { kind: 'subagent-report', scope: t, input: null, onRestart: 'resume' },
                key: key('c29')
              }
            ],
            null
          )
        )
      await ensure()
      await h.settle()
      const keySeen = (await read(h, t)).keysSeen.has(key('c29'))
      same([runs, keySeen], [1, false], 'a finished job must have run once and left keysSeen')
      await ensure()
      await h.settle()
      same(runs, 2, 'an ensure under the key of an ended job must create a new job')
    }
  },
  // Catches jobs deduplicated by kind, which drops the next driver's ensure while the previous driver exits and loses its wakeup (H4).
  {
    name: 'an ensure under the next driver generation creates a job while the previous driver is exiting',
    covers: ['jobs.register', 'ledger.transact'],
    needs: [],
    async run(open) {
      const exited = latch()
      const finish = latch()
      let runs = 0
      // The final decide: the driver stops and records its exit in the same transaction.
      const driver: JobHandler = async (ports, spec) => {
        runs += 1
        await ports.ledger.transact(spec.scope, (f) => {
          const generation = idleDriverGeneration(f.history)
          return step(
            [
              {
                type: 'append-record',
                thread: spec.scope,
                record: { type: 'idle-driver-exit', value: { generation } },
                key: keys.idleDriverExit(spec.scope, generation)
              }
            ],
            null
          )
        })
        exited.release()
        await finish.promise
      }
      const h = await open((p) => p.jobs.register('idle-driver', driver))
      const t = await h.createThread()
      const ensure = () =>
        transact(h, t, (f) => {
          const driverKey = keys.idleDriver(t, idleDriverGeneration(f.history))
          const job = { kind: 'idle-driver', scope: t, input: null, onRestart: 'abandon' } as const
          return step(f.keysSeen.has(driverKey) ? [] : [{ type: 'ensure-job', job, key: driverKey }], driverKey)
        })
      const first = (await ensure()).result
      await exited.promise
      const second = (await ensure()).result
      check(second !== first, 'the exit record must move the driver key to the next generation')
      finish.release()
      await h.settle()
      check(runs === 2, 'an ensure under the next generation must create a job while the previous driver still lives')
    }
  },
  // Catches a memo that forgets across restarts or stores a failed answer, so a person is asked again (DP K3).
  {
    name: 'remember keeps the first stored value across a restart and stores nothing on rejection',
    covers: ['memory.remember'],
    needs: ['restart'],
    async run(open) {
      const h = await open(() => {})
      const t = await h.createThread()
      let produced = 0
      const remember = (label: string, value: string) =>
        h.withCall(t, (p) =>
          p.memory.remember(key(label), async () => {
            produced += 1
            return value
          })
        )
      check((await remember('c17', 'first')) === 'first', 'the first value must be stored')
      check((await remember('c17', 'second')) === 'first' && produced === 1, 'a stored name must not produce again')
      await h.restart()
      check((await remember('c17', 'third')) === 'first' && produced === 1, 'a stored value must survive a restart')
      await rejects(
        () => h.withCall(t, (p) => p.memory.remember(key('c17-fail'), () => Promise.reject(new Error('no answer')))),
        'a rejected produce must reject remember'
      )
      check((await remember('c17-fail', 'later')) === 'later', 'a rejected produce must store nothing')
    }
  },
  // Catches a clock that returns fractional or backwards time, or a negative value, which breaks budgets and stop timestamps.
  {
    name: 'clock reads non-decreasing whole milliseconds',
    covers: ['clock.now'],
    needs: [],
    async run(open) {
      const h = await open(() => {})
      const t = await h.createThread()
      const [a, b] = await h.withCall(t, async (p) => [p.clock.now(), p.clock.now()])
      check(Number.isInteger(a) && a >= 0 && b >= a, 'the clock must give non-decreasing whole milliseconds')
    }
  },
  // Catches ports that keep working after their call ended, unlike Durable's call-bound handles (Review focus 4).
  {
    name: 'bound ports expire when their call ends',
    covers: ['ledger.read', 'memory.remember'],
    needs: [],
    async run(open) {
      const h = await open(() => {})
      const t = await h.createThread()
      let kept: BoundPorts | undefined
      await h.withCall(t, async (p) => {
        kept = p
      })
      await rejects(() => kept!.ledger.read(t), 'ports must reject once their call has ended')
      await rejects(() => kept!.memory.remember(key('c25'), async () => 'late'), 'an ended call must not store')
      await rejects(
        () => kept!.ledger.transact(t, () => step([append(t, 'late', 'c25-late')], null)),
        'an ended call must not write'
      )
      check(!(await read(h, t)).keysSeen.has(key('c25-late')), 'nothing an ended call tried may land')
    }
  }
]
