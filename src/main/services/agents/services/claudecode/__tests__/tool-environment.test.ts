import type { Tool, ToolEnvironment } from '@types'
import { describe, expect, it } from 'vitest'

import {
  filterToolsByEnvironment,
  getBuiltinTools,
  getDisabledBuiltinToolIds,
  getSupportedToolIds,
  getUnsupportedToolIds,
  isToolSupportedInEnvironment,
  partitionToolsByEnvironment
} from '../tool-environment'
import { builtinTools } from '../tools'

/**
 * Tests for tool environment filtering functions.
 * Verifies that tools are correctly filtered based on their supported environments
 * (electron vs browser) to ensure proper functionality in different runtime contexts.
 */

describe('tool-environment', () => {
  // Expected electron-only tools (require filesystem/shell)
  const ELECTRON_ONLY_TOOL_IDS = [
    'Bash',
    'Edit',
    'Glob',
    'Grep',
    'MultiEdit',
    'NotebookEdit',
    'NotebookRead',
    'Read',
    'Write'
  ]

  // Expected cross-environment tools (work in both electron and browser)
  const ALL_ENV_TOOL_IDS = ['Task', 'TodoWrite', 'WebFetch', 'WebSearch']

  describe('builtinTools', () => {
    it('should have all expected builtin tools defined', () => {
      const allExpectedIds = [...ELECTRON_ONLY_TOOL_IDS, ...ALL_ENV_TOOL_IDS]
      const actualIds = builtinTools.map((t) => t.id)

      for (const id of allExpectedIds) {
        expect(actualIds).toContain(id)
      }
    })

    it('should have correct structure for all tools', () => {
      for (const tool of builtinTools) {
        expect(tool.id).toBeDefined()
        expect(tool.name).toBeDefined()
        expect(tool.description).toBeDefined()
        expect(tool.type).toBe('builtin')
        expect(tool.supportedEnvironments).toBeDefined()
        expect(Array.isArray(tool.supportedEnvironments)).toBe(true)
      }
    })

    it('should have all tools with valid environment values', () => {
      const validEnvironments: ToolEnvironment[] = ['electron', 'browser']

      for (const tool of builtinTools) {
        for (const env of tool.supportedEnvironments!) {
          expect(validEnvironments).toContain(env)
        }
      }
    })
  })

  describe('isToolSupportedInEnvironment', () => {
    it('should return true for electron-only tools in electron environment', () => {
      const bashTool = builtinTools.find((t) => t.id === 'Bash')!
      expect(isToolSupportedInEnvironment(bashTool, 'electron')).toBe(true)
    })

    it('should return false for electron-only tools in browser environment', () => {
      const bashTool = builtinTools.find((t) => t.id === 'Bash')!
      expect(isToolSupportedInEnvironment(bashTool, 'browser')).toBe(false)
    })

    it('should return true for cross-environment tools in electron', () => {
      const todoTool = builtinTools.find((t) => t.id === 'TodoWrite')!
      expect(isToolSupportedInEnvironment(todoTool, 'electron')).toBe(true)
    })

    it('should return true for cross-environment tools in browser', () => {
      const todoTool = builtinTools.find((t) => t.id === 'TodoWrite')!
      expect(isToolSupportedInEnvironment(todoTool, 'browser')).toBe(true)
    })

    it('should default to electron-only when supportedEnvironments is undefined', () => {
      const toolWithoutEnv: Tool = {
        id: 'TestTool',
        name: 'TestTool',
        type: 'builtin'
      }
      expect(isToolSupportedInEnvironment(toolWithoutEnv, 'electron')).toBe(true)
      expect(isToolSupportedInEnvironment(toolWithoutEnv, 'browser')).toBe(false)
    })

    it('should handle Task tool being available in all environments', () => {
      const taskTool = builtinTools.find((t) => t.id === 'Task')!
      expect(isToolSupportedInEnvironment(taskTool, 'electron')).toBe(true)
      expect(isToolSupportedInEnvironment(taskTool, 'browser')).toBe(true)
    })
  })

  describe('filterToolsByEnvironment', () => {
    it('should return all tools for electron environment', () => {
      const electronTools = filterToolsByEnvironment(builtinTools, 'electron')
      expect(electronTools.length).toBe(builtinTools.length)
    })

    it('should return only cross-environment tools for browser', () => {
      const browserTools = filterToolsByEnvironment(builtinTools, 'browser')
      const browserToolIds = browserTools.map((t) => t.id)

      // Browser should include cross-environment tools
      for (const id of ALL_ENV_TOOL_IDS) {
        expect(browserToolIds).toContain(id)
      }

      // Browser should NOT include electron-only tools
      for (const id of ELECTRON_ONLY_TOOL_IDS) {
        expect(browserToolIds).not.toContain(id)
      }
    })

    it('should return empty array when no tools match', () => {
      const electronOnlyTools: Tool[] = [
        { id: 'ElectronOnly', name: 'ElectronOnly', type: 'builtin', supportedEnvironments: ['electron'] }
      ]
      const result = filterToolsByEnvironment(electronOnlyTools, 'browser')
      expect(result).toEqual([])
    })
  })

  describe('getBuiltinTools', () => {
    it('should return all tools when no environment specified (backward compatible)', () => {
      const tools = getBuiltinTools()
      expect(tools.length).toBe(builtinTools.length)
      expect(tools).toEqual(builtinTools)
    })

    it('should return all tools for electron environment', () => {
      const tools = getBuiltinTools('electron')
      expect(tools.length).toBe(builtinTools.length)
    })

    it('should return only browser-compatible tools for browser environment', () => {
      const tools = getBuiltinTools('browser')
      const toolIds = tools.map((t) => t.id)

      expect(toolIds.length).toBe(ALL_ENV_TOOL_IDS.length)
      for (const id of ALL_ENV_TOOL_IDS) {
        expect(toolIds).toContain(id)
      }
    })

    it('should include Task tool in browser environment', () => {
      const browserTools = getBuiltinTools('browser')
      const taskTool = browserTools.find((t) => t.id === 'Task')
      expect(taskTool).toBeDefined()
      expect(taskTool?.name).toBe('Task')
    })
  })

  describe('getUnsupportedToolIds', () => {
    it('should return empty array for electron (all tools supported)', () => {
      const unsupported = getUnsupportedToolIds(builtinTools, 'electron')
      expect(unsupported).toEqual([])
    })

    it('should return electron-only tool IDs for browser', () => {
      const unsupported = getUnsupportedToolIds(builtinTools, 'browser')

      for (const id of ELECTRON_ONLY_TOOL_IDS) {
        expect(unsupported).toContain(id)
      }
      for (const id of ALL_ENV_TOOL_IDS) {
        expect(unsupported).not.toContain(id)
      }
    })
  })

  describe('getDisabledBuiltinToolIds', () => {
    it('should return empty array for electron', () => {
      const disabled = getDisabledBuiltinToolIds('electron')
      expect(disabled).toEqual([])
    })

    it('should return electron-only tools for browser', () => {
      const disabled = getDisabledBuiltinToolIds('browser')

      expect(disabled.length).toBe(ELECTRON_ONLY_TOOL_IDS.length)
      for (const id of ELECTRON_ONLY_TOOL_IDS) {
        expect(disabled).toContain(id)
      }
    })

    it('should NOT include Task in disabled tools for browser', () => {
      const disabled = getDisabledBuiltinToolIds('browser')
      expect(disabled).not.toContain('Task')
    })
  })

  describe('getSupportedToolIds', () => {
    it('should return all tool IDs for electron', () => {
      const supported = getSupportedToolIds(builtinTools, 'electron')
      expect(supported.length).toBe(builtinTools.length)
    })

    it('should return only cross-environment tool IDs for browser', () => {
      const supported = getSupportedToolIds(builtinTools, 'browser')

      expect(supported.length).toBe(ALL_ENV_TOOL_IDS.length)
      for (const id of ALL_ENV_TOOL_IDS) {
        expect(supported).toContain(id)
      }
    })
  })

  describe('partitionToolsByEnvironment', () => {
    it('should partition correctly for electron (all supported)', () => {
      const { supported, unsupported } = partitionToolsByEnvironment(builtinTools, 'electron')

      expect(supported.length).toBe(builtinTools.length)
      expect(unsupported.length).toBe(0)
    })

    it('should partition correctly for browser', () => {
      const { supported, unsupported } = partitionToolsByEnvironment(builtinTools, 'browser')

      expect(supported.length).toBe(ALL_ENV_TOOL_IDS.length)
      expect(unsupported.length).toBe(ELECTRON_ONLY_TOOL_IDS.length)

      const supportedIds = supported.map((t) => t.id)
      const unsupportedIds = unsupported.map((t) => t.id)

      for (const id of ALL_ENV_TOOL_IDS) {
        expect(supportedIds).toContain(id)
      }
      for (const id of ELECTRON_ONLY_TOOL_IDS) {
        expect(unsupportedIds).toContain(id)
      }
    })

    it('should have no overlap between supported and unsupported', () => {
      const { supported, unsupported } = partitionToolsByEnvironment(builtinTools, 'browser')
      const supportedIds = new Set(supported.map((t) => t.id))
      const unsupportedIds = new Set(unsupported.map((t) => t.id))

      for (const id of supportedIds) {
        expect(unsupportedIds.has(id)).toBe(false)
      }
    })

    it('should cover all tools (supported + unsupported = total)', () => {
      const { supported, unsupported } = partitionToolsByEnvironment(builtinTools, 'browser')
      expect(supported.length + unsupported.length).toBe(builtinTools.length)
    })
  })

  describe('cross-environment tools specifics', () => {
    it('TodoWrite should be available in both environments', () => {
      const todoTool = builtinTools.find((t) => t.id === 'TodoWrite')!
      expect(todoTool.supportedEnvironments).toContain('electron')
      expect(todoTool.supportedEnvironments).toContain('browser')
    })

    it('WebFetch should be available in both environments', () => {
      const webFetchTool = builtinTools.find((t) => t.id === 'WebFetch')!
      expect(webFetchTool.supportedEnvironments).toContain('electron')
      expect(webFetchTool.supportedEnvironments).toContain('browser')
    })

    it('WebSearch should be available in both environments', () => {
      const webSearchTool = builtinTools.find((t) => t.id === 'WebSearch')!
      expect(webSearchTool.supportedEnvironments).toContain('electron')
      expect(webSearchTool.supportedEnvironments).toContain('browser')
    })

    it('Task should be available in both environments', () => {
      const taskTool = builtinTools.find((t) => t.id === 'Task')!
      expect(taskTool.supportedEnvironments).toContain('electron')
      expect(taskTool.supportedEnvironments).toContain('browser')
    })
  })

  describe('electron-only tools specifics', () => {
    const electronOnlyToolsToCheck = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep']

    for (const toolId of electronOnlyToolsToCheck) {
      it(`${toolId} should only be available in electron`, () => {
        const tool = builtinTools.find((t) => t.id === toolId)!
        expect(tool.supportedEnvironments).toContain('electron')
        expect(tool.supportedEnvironments).not.toContain('browser')
      })
    }
  })
})
