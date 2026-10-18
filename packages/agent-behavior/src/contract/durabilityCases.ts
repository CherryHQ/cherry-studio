import type { JobHandler, BoundPorts } from '../ports/harness'
import { check, rejects, same } from './assert'
import { append, key, latch, noticeTexts, read, step, transact } from './fixtures'
import type { ContractCase } from './harness'

export const durabilityCases: readonly ContractCase[] = [
  // Catches resume jobs that skip or repeat keyed steps, or abandon jobs that keep running (design §6.1 H4).
  {
    name: 'resume jobs rerun from the start after a restart; abandon jobs are dropped',
    covers: ['jobs.register', 'ledger.transact'],
    needs: ['restart'],
    async run(open) {
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
      check(!(await read(h, t)).keysSeen.has(key('c16-abandon')), 'an abandoned job must leave keysSeen on restart')
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
  // Catches a clock that returns fractional or relative time (e.g. performance.now()) or a negative value, which breaks budgets and stop timestamps.
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
