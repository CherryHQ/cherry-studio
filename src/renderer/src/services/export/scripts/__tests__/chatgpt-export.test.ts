import { describe, expect, it } from 'vitest'

import { buildChatGPTExportScript } from '../chatgpt-export'

describe('ChatGPT 导出脚本构造器', () => {
  it('应包含团队空间所需的请求头与项目端点', () => {
    const script = buildChatGPTExportScript()

    // 团队空间关键：通过 ChatGPT-Account-Id 选择 workspace
    expect(script).toContain('ChatGPT-Account-Id')

    // 团队空间项目(Project/Gizmo)补齐：侧栏 + 项目对话列表
    expect(script).toContain('/backend-api/gizmos/snorlax/sidebar')
    expect(script).toContain('/backend-api/gizmos/')
    expect(script).toContain('/conversations?cursor=')
  })

  it('应返回可执行的 IIFE 字符串', () => {
    const script = buildChatGPTExportScript()
    expect(script).toContain('(async () => {')
    expect(script).toContain('})()')
  })
})
