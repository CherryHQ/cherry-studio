import { render, screen } from '@testing-library/react'
import i18next from 'i18next'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import {
  type ComposerToolRegistration,
  defineTool,
  TopicType,
  type ToolActionMap,
  type ToolContextSource,
  type ToolDefinition,
  type ToolRenderContext,
  type ToolStateMap
} from '../types'

describe('composer tool dependency contracts', () => {
  it('keeps exact dependency types and requires declarations and prepared registrations', () => {
    defineTool({
      key: 'files',
      label: 'Files',
      dependencies: { state: ['files'], actions: ['setFiles'] },
      composer: {
        menuItems: {
          createItems: ({ state, actions }) => {
            expectTypeOf<keyof typeof state>().toEqualTypeOf<'files'>()
            expectTypeOf(state.files).toEqualTypeOf<ToolStateMap['files']>()
            expectTypeOf<keyof typeof actions>().toEqualTypeOf<'setFiles'>()
            expectTypeOf(actions.setFiles).toEqualTypeOf<ToolActionMap['setFiles']>()
            return []
          }
        }
      }
    })
    defineTool({
      key: 'text',
      label: 'Text',
      dependencies: { actions: ['onTextChange'] },
      composer: {
        menuItems: {
          createItems: ({ state, actions }) => {
            expectTypeOf<keyof typeof state>().toEqualTypeOf<never>()
            expectTypeOf<keyof typeof actions>().toEqualTypeOf<'onTextChange'>()
            return []
          }
        }
      }
    })
    defineTool({
      key: 'empty',
      label: 'Empty',
      composer: {
        menuItems: {
          createItems: ({ state, actions }) => {
            expectTypeOf<keyof typeof state>().toEqualTypeOf<never>()
            expectTypeOf<keyof typeof actions>().toEqualTypeOf<never>()
            return []
          }
        }
      }
    })

    expectTypeOf<keyof ToolStateMap>().toEqualTypeOf<
      | 'files'
      | 'mentionedModels'
      | 'selectedKnowledgeBases'
      | 'couldAddImageFile'
      | 'extensions'
      | 'selectableKnowledgeBases'
    >()
    expectTypeOf<keyof ToolActionMap>().toEqualTypeOf<
      'setFiles' | 'setMentionedModels' | 'setSelectedKnowledgeBases' | 'addNewTopic' | 'onTextChange'
    >()
    expectTypeOf<{ key: string; label: string }>().not.toExtend<ToolDefinition<readonly ['files']>>()
    expectTypeOf<{ key: string; label: string }>().not.toExtend<ToolDefinition<readonly [], readonly ['setFiles']>>()
    expectTypeOf<{ key: string; label: string }>().not.toExtend<ComposerToolRegistration>()
  })

  it('projects frozen heterogeneous definitions without leaking provider internals or losing references', () => {
    const source: ToolContextSource = {
      scope: TopicType.Session,
      session: { sessionId: 'session-1', agentId: 'agent-1' },
      state: {
        files: [],
        mentionedModels: [],
        selectedKnowledgeBases: [],
        couldAddImageFile: false,
        extensions: ['.txt'],
        selectableKnowledgeBases: []
      },
      actions: {
        setFiles: vi.fn<ToolActionMap['setFiles']>(),
        setMentionedModels: vi.fn<ToolActionMap['setMentionedModels']>(),
        setSelectedKnowledgeBases: vi.fn<ToolActionMap['setSelectedKnowledgeBases']>(),
        addNewTopic: vi.fn<ToolActionMap['addNewTopic']>(),
        onTextChange: vi.fn<ToolActionMap['onTextChange']>()
      },
      launcher: { registerLaunchers: () => () => undefined },
      t: i18next.t
    }
    const received: ToolRenderContext<readonly ['files'], readonly ['setFiles']>[] = []
    const filesTool = defineTool(
      Object.freeze<ToolDefinition<readonly ['files'], readonly ['setFiles']>>({
        key: 'files',
        label: 'Files',
        dependencies: { state: ['files'], actions: ['setFiles'] },
        composer: {
          menuItems: {
            createItems: (context) => {
              received.push(context)
              return []
            }
          },
          tokens: { reconcile: (_draft, { actions }) => actions.setFiles([]) },
          runtime: ({ context }) => {
            received.push(context)
            return <output aria-label="File count">{context.state.files.length}</output>
          }
        }
      })
    )
    const extensions: string[][] = []
    const extensionsTool = defineTool<readonly ['extensions']>(
      Object.freeze<ToolDefinition<readonly ['extensions']>>({
        key: 'extensions',
        label: 'Extensions',
        dependencies: { state: ['extensions'] },
        composer: {
          menuItems: {
            createItems: ({ state, actions }) => {
              expect(Object.keys(state)).toEqual(['extensions'])
              expect(Object.keys(actions)).toEqual([])
              extensions.push(state.extensions)
              return []
            }
          }
        }
      })
    )
    const registrations: ComposerToolRegistration[] = [filesTool, extensionsTool]
    for (const tool of registrations) {
      const prepared = tool.prepareRuntime(source)
      prepared.createItems?.()
      if (prepared.render) render(prepared.render())
    }

    expect(screen.getByLabelText('File count')).toHaveTextContent('0')
    expect(received).toHaveLength(2)
    expect(received[0]).toBe(received[1])
    for (const context of received) {
      expect(Object.keys(context.state)).toEqual(['files'])
      expect(Object.keys(context.actions)).toEqual(['setFiles'])
      expect(context.state.files).toBe(source.state.files)
      expect(context.actions.setFiles).toBe(source.actions.setFiles)
      expect(context.assistant).toBeUndefined()
      expect(context.model).toBeUndefined()
      expect(context.session).toBe(source.session)
      expect(context.launcher).toBe(source.launcher)
      expect(context.t).toBe(source.t)
    }
    expect(extensions[0]).toBe(source.state.extensions)
    filesTool.reconcileTokens?.([], source)
    expect(source.actions.setFiles).toHaveBeenCalledWith([])
  })
})
