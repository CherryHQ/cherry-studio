import path from 'node:path'

import { KnowledgeBaseParams } from '@types'
import { app } from 'electron'

import { EmbedJsFramework } from './EmbedJsFramework'
import { IKnowledgeFramework } from './IKnowledgeFramework'
import { LangChainFramework } from './LangChainFramework'
class KnowledgeFrameworkFactory {
  private static instance: KnowledgeFrameworkFactory
  private frameworks: Map<string, IKnowledgeFramework> = new Map()
  private storageDir: string

  private constructor(storageDir: string) {
    this.storageDir = storageDir
  }

  public static getInstance(storageDir: string): KnowledgeFrameworkFactory {
    if (!KnowledgeFrameworkFactory.instance) {
      KnowledgeFrameworkFactory.instance = new KnowledgeFrameworkFactory(storageDir)
    }
    return KnowledgeFrameworkFactory.instance
  }

  public getFramework(base: KnowledgeBaseParams): IKnowledgeFramework {
    const frameworkType = base.framework || 'embedjs' // 如果未指定，默认为 embedjs
    if (this.frameworks.has(frameworkType)) {
      return this.frameworks.get(frameworkType)!
    }
    let framework: IKnowledgeFramework
    switch (frameworkType) {
      case 'langchain':
        framework = new LangChainFramework(this.storageDir)
        break
      case 'embedjs':
      default:
        framework = new EmbedJsFramework(this.storageDir)
        break
    }

    this.frameworks.set(frameworkType, framework)
    return framework
  }
}

export const knowledgeFrameworkFactory = KnowledgeFrameworkFactory.getInstance(
  path.join(app.getPath('userData'), 'Data', 'KnowledgeBase')
)
