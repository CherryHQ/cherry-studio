import { describe, expect, it } from 'vitest'

import type { SubagentView } from '@cherrystudio/agent-behavior'
import { runtimeId } from '@cherrystudio/agent-runtime'

import type { AgentRuntimeEvent } from '../types'
import { PiChildTasks } from './PiChildTasks'

function tasks(origins: Record<string, { toolCallId: string; description?: string }> = {}) {
  const events: AgentRuntimeEvent[] = []
  const childTasks = new PiChildTasks(
    (id) => origins[id],
    (event) => events.push(event)
  )
  return { childTasks, events }
}

function view(id: string, status: SubagentView['status'], outcome?: SubagentView['outcome']): SubagentView {
  return { sessionId: runtimeId(id), parentToolCallId: `call-${id}`, description: `task ${id}`, status, outcome }
}

describe('PiChildTasks', () => {
  it('announces a child once, skips unchanged repeats and reports its finish under the same title', () => {
    const { childTasks, events } = tasks({ a: { toolCallId: 'call-a', description: 'Research' } })
    childTasks.publish('a', 'in_progress', true)
    childTasks.publish('a', 'in_progress', true)
    childTasks.publish('a', 'completed')

    expect(events).toEqual([
      {
        type: 'background-task-event',
        data: {
          event: 'started',
          taskId: 'a',
          toolUseId: 'call-a',
          taskType: 'subagent',
          title: 'Research',
          status: 'in_progress',
          isBackgrounded: true
        }
      },
      {
        type: 'background-task-event',
        data: {
          event: 'notification',
          taskId: 'a',
          toolUseId: 'call-a',
          taskType: 'subagent',
          title: 'Research',
          status: 'completed',
          isBackgrounded: true
        }
      }
    ])
    expect(childTasks.status('a')).toBe('completed')
  })

  it('republishes a child once its origin becomes known', () => {
    const origins: Record<string, { toolCallId: string; description?: string }> = {}
    const { childTasks, events } = tasks(origins)
    childTasks.publish('a', 'in_progress')
    origins.a = { toolCallId: 'call-a', description: 'Research' }
    childTasks.publish('a', 'in_progress')

    expect(events.at(-1)).toMatchObject({
      data: { event: 'updated', toolUseId: 'call-a', title: 'Research', isBackgrounded: false }
    })
    expect(events).toHaveLength(2)
  })

  it('maps subagent views to task states and lists only running children when asked', () => {
    const { childTasks, events } = tasks()
    childTasks.showSubagents([view('run', 'running'), view('done', 'finished', 'interrupted')], true)

    expect(events.map((event) => (event.type === 'background-task-event' ? event.data.status : event.type))).toEqual([
      'in_progress',
      'stopped',
      'background-tasks'
    ])
    expect(events.at(-1)).toEqual({
      type: 'background-tasks',
      tasks: [{ id: 'run', type: 'subagent', description: 'task run', toolCallId: undefined }]
    })
  })

  it('updates task states without replacing the running list for a non-root thread', () => {
    const { childTasks, events } = tasks()
    childTasks.showSubagents([view('nested', 'running')], false)

    expect(events.map((event) => event.type)).toEqual(['background-task-event'])
  })
})
