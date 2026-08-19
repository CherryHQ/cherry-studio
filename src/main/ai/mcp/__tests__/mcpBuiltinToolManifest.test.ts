import { MCP_BUILTIN_RUNTIME_NAMES as R } from '@shared/ai/tools/mcpBuiltinRuntimeNames'
import { MCP_BUILTIN_SERVER_IDS as IDS } from '@shared/ai/tools/mcpToolIdentity'
import { describe, expect, it } from 'vitest'

import { getBuiltinRuntimeName } from '../mcpBuiltinToolManifest'

describe('built-in MCP runtime manifest', () => {
  it('matches the shared provider-visible names to the main SHA-256 builder', () => {
    expect(getBuiltinRuntimeName(IDS.cherryTools, 'web_search')).toBe(R.cherryTools.webSearch)
    expect(getBuiltinRuntimeName(IDS.cherryTools, 'web_fetch')).toBe(R.cherryTools.webFetch)
    expect(getBuiltinRuntimeName(IDS.cherryTools, 'kb_search')).toBe(R.cherryTools.kbSearch)
    expect(getBuiltinRuntimeName(IDS.cherryTools, 'kb_list')).toBe(R.cherryTools.kbList)
    expect(getBuiltinRuntimeName(IDS.cherryTools, 'kb_read')).toBe(R.cherryTools.kbRead)
    expect(getBuiltinRuntimeName(IDS.cherryTools, 'kb_manage')).toBe(R.cherryTools.kbManage)
    expect(getBuiltinRuntimeName(IDS.cherryTools, 'to_markdown')).toBe(R.cherryTools.toMarkdown)
    expect(getBuiltinRuntimeName(IDS.cherryTools, 'cron')).toBe(R.cherryTools.cron)
    expect(getBuiltinRuntimeName(IDS.cherryTools, 'notify')).toBe(R.cherryTools.notify)
    expect(getBuiltinRuntimeName(IDS.cherryTools, 'config')).toBe(R.cherryTools.config)
    expect(getBuiltinRuntimeName(IDS.cherryTools, 'generate_image')).toBe(R.cherryTools.generateImage)
    expect(getBuiltinRuntimeName(IDS.cherryTools, 'report_artifacts')).toBe(R.cherryTools.reportArtifacts)
    expect(getBuiltinRuntimeName(IDS.agentMemory, 'memory')).toBe(R.agentMemory.memory)
    expect(getBuiltinRuntimeName(IDS.skills, 'search_skills')).toBe(R.skills.searchSkills)
    expect(getBuiltinRuntimeName(IDS.skills, 'install_skill')).toBe(R.skills.installSkill)
    expect(getBuiltinRuntimeName(IDS.assistant, 'navigate')).toBe(R.assistant.navigate)
    expect(getBuiltinRuntimeName(IDS.assistant, 'product_info')).toBe(R.assistant.productInfo)
    expect(getBuiltinRuntimeName(IDS.assistant, 'diagnose')).toBe(R.assistant.diagnose)
    expect(getBuiltinRuntimeName(IDS.assistant, 'apply_setting')).toBe(R.assistant.applySetting)
    expect(getBuiltinRuntimeName(IDS.assistant, 'create_agent')).toBe(R.assistant.createAgent)
    expect(getBuiltinRuntimeName(IDS.assistantFiles, 'read_file')).toBe(R.assistantFiles.readFile)
    expect(getBuiltinRuntimeName(IDS.assistantFiles, 'move_to_trash')).toBe(R.assistantFiles.moveToTrash)
    expect(getBuiltinRuntimeName(IDS.assistantFiles, 'save_attachment')).toBe(R.assistantFiles.saveAttachment)
  })
})
