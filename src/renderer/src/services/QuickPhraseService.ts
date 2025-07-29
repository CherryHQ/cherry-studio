import { loggerService } from '@logger'
import db from '@renderer/databases'
import { QuickPhrase } from '@renderer/types'
import { v4 as uuidv4 } from 'uuid'

const logger = loggerService.withContext('QuickPhraseService')

export class QuickPhraseService {
  private static _isInitialized: boolean = false

  static async init() {
    if (QuickPhraseService._isInitialized) {
      return
    }

    try {
      await db.open()
      QuickPhraseService._isInitialized = true
    } catch (error) {
      logger.error('Failed to open Dexie database:', error as Error)
    }
  }

  static async getAll(): Promise<QuickPhrase[]> {
    // Ensure database is initialized before
    await QuickPhraseService.init()
    const phrases = await db.quick_phrases.toArray()
    return phrases.sort((a, b) => (b.order ?? 0) - (a.order ?? 0))
  }

  static async add(data: Pick<QuickPhrase, 'title' | 'content'>): Promise<QuickPhrase> {
    const now = Date.now()
    const phrases = await this.getAll()

    await Promise.all(
      phrases.map((phrase) =>
        db.quick_phrases.update(phrase.id, {
          order: (phrase.order ?? 0) + 1
        })
      )
    )

    const phrase: QuickPhrase = {
      id: uuidv4(),
      title: data.title,
      content: data.content,
      createdAt: now,
      updatedAt: now,
      order: 0
    }

    await db.quick_phrases.add(phrase)
    return phrase
  }

  static async update(id: string, data: Pick<QuickPhrase, 'title' | 'content'>): Promise<void> {
    await QuickPhraseService.init()
    await db.quick_phrases.update(id, {
      ...data,
      updatedAt: Date.now()
    })
  }

  static async delete(id: string): Promise<void> {
    await db.quick_phrases.delete(id)
    const phrases = await this.getAll()
    await Promise.all(
      phrases.map((phrase, index) =>
        db.quick_phrases.update(phrase.id, {
          order: phrases.length - 1 - index
        })
      )
    )
  }

  static async updateOrder(phrases: QuickPhrase[]): Promise<void> {
    const now = Date.now()
    await QuickPhraseService.init()
    await Promise.all(
      phrases.map((phrase, index) =>
        db.quick_phrases.update(phrase.id, {
          order: phrases.length - 1 - index,
          updatedAt: now
        })
      )
    )
  }
}

export default QuickPhraseService
