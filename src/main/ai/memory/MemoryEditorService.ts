import { randomUUID } from 'node:crypto'

import { application } from '@application'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { WindowType } from '@main/core/window/types'
import type { MemoryScope } from '@shared/types/memory'

import { editorMemoryAuthority } from './memoryAuthority'
import type { MemorySession } from './MemoryService'

@Injectable('MemoryEditorService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['MemoryService', 'MemoryMigrationService', 'WindowManager'])
export class MemoryEditorService extends BaseService {
  private readonly editors = new Map<string, { senderId: string; session: MemorySession }>()

  protected onInit(): void {
    this.registerDisposable(
      application.get('WindowManager').onWindowDestroyedByType(WindowType.Main, ({ id }) => {
        for (const [editorId, editor] of this.editors) {
          if (editor.senderId === id) this.close(id, editorId)
        }
      })
    )
  }

  open(senderId: string | null, scope: MemoryScope): string {
    const authority = editorMemoryAuthority(senderId, scope)
    if (scope.kind === 'private') application.get('MemoryMigrationService').retryFromEditor(scope.agentId)
    const session = application.get('MemoryService').open(authority)
    const editorId = randomUUID()
    this.editors.set(editorId, { senderId: senderId!, session })
    return editorId
  }

  get(senderId: string | null, editorId: string): MemorySession {
    const editor = this.editors.get(editorId)
    if (!senderId || !editor || editor.senderId !== senderId) throw new Error('Memory editor is unavailable')
    return editor.session
  }

  close(senderId: string | null, editorId: string): void {
    const editor = this.editors.get(editorId)
    if (!editor) return
    this.get(senderId, editorId).dispose()
    this.editors.delete(editorId)
  }

  protected onStop(): void {
    for (const editor of this.editors.values()) editor.session.dispose()
    this.editors.clear()
  }
}
