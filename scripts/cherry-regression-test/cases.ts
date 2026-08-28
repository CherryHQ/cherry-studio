import type { RegressionCase } from './types'

const modes = ['branch', 'tag'] as const

export const REGRESSION_CASES: RegressionCase[] = [
  { id: 'S-01', title: '应用启动冒烟测试', task: 'startup-smoke', profile: 'authenticated', modes: [...modes] },
  { id: 'APP-01', title: '打开小程序', task: 'mini-app', profile: 'authenticated', modes: [...modes] },
  { id: 'N-01', title: '创建和保存笔记', task: 'notes', profile: 'authenticated', modes: [...modes] },
  {
    id: 'M-02',
    title: '配置自定义聊天服务商并完成聊天',
    task: 'custom-provider-chat',
    profile: 'authenticated',
    modes: [...modes]
  },
  {
    id: 'C-01',
    title: '创建自定义助手并聊天',
    task: 'custom-assistant',
    profile: 'authenticated',
    modes: [...modes]
  },
  { id: 'T-01', title: '文本翻译', task: 'translation', profile: 'authenticated', modes: [...modes] },
  { id: 'T-02', title: 'PDF 文件翻译', task: 'translation', profile: 'authenticated', modes: [...modes] },
  {
    id: 'C-02',
    title: '使用快捷助手完成全局问答',
    task: 'quick-assistant',
    profile: 'authenticated',
    modes: [...modes]
  },
  {
    id: 'C-03',
    title: '使用划词助手处理跨应用选中文本',
    task: 'selection-assistant',
    profile: 'authenticated',
    modes: [...modes]
  },
  {
    id: 'K-01',
    title: '配置嵌入服务商并创建知识库',
    task: 'knowledge-import',
    profile: 'authenticated',
    modes: [...modes]
  },
  {
    id: 'K-02',
    title: '基于知识库问答并验证引用',
    task: 'knowledge-qa',
    profile: 'authenticated',
    modes: [...modes]
  },
  {
    id: 'MCP-01',
    title: '创建并使用 Everything MCP',
    task: 'everything-mcp',
    profile: 'authenticated',
    modes: [...modes]
  },
  {
    id: 'A-02',
    title: '从文件夹导入 Skill 并验证生效',
    task: 'skill-import',
    profile: 'authenticated',
    modes: [...modes]
  },
  { id: 'CODE-01', title: '启动 Claude Code', task: 'code-cli', profile: 'authenticated', modes: [...modes] },
  { id: 'CODE-02', title: '启动 Codex', task: 'code-cli', profile: 'authenticated', modes: [...modes] },
  { id: 'CODE-03', title: '启动 OpenClaw', task: 'openclaw', profile: 'authenticated', modes: [...modes] },
  {
    id: 'M-01',
    title: '登录 CherryIN 并完成聊天',
    task: 'cherryin-chat',
    profile: 'authenticated',
    modes: [...modes]
  },
  {
    id: 'P-01',
    title: '使用图像模型生成图片',
    task: 'image-generation',
    profile: 'authenticated',
    modes: [...modes]
  },
  {
    id: 'A-03',
    title: 'Claude Agent Runtime',
    task: 'claude-agent-runtime',
    profile: 'authenticated',
    modes: [...modes]
  },
  { id: 'A-04', title: 'Pi Runtime', task: 'pi-runtime', profile: 'authenticated', modes: [...modes] },
  {
    id: 'A-05',
    title: 'DeepSeek Harness Runtime',
    task: 'deepseek-harness-runtime',
    profile: 'authenticated',
    modes: [...modes]
  },
  {
    id: 'A-01',
    title: '默认 Agent 完成 PPT 任务',
    task: 'agent-ppt',
    profile: 'authenticated',
    modes: [...modes]
  }
]
