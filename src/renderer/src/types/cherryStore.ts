export enum CherryStoreType {
  ASSISTANT = 'assistant',
  MINI_APP = 'mini-app'
  // KNOWLEDGE = 'Knowledge',
  // MCP_SERVER = 'MCP-Server',
  // MODEL_PROVIDER = 'Model-Provider',
  // AGENT = 'Agent',
  // TRANSLATE = 'Translate',
  // PAINTINGS = 'Paintings',
  // FILES = 'Files'
}

export interface SubCategoryItem {
  id: string
  name: string
  count?: number // count 是可选的，因为并非所有二级分类都有
  isActive?: boolean
}

export interface Category {
  id: CherryStoreType
  title: string
  items: SubCategoryItem[]
}
