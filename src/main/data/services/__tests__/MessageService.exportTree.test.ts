// Load the sibling so it self-registers in the data-service registry (prod loads it via its DataApi handler).
import '@data/services/TopicService'

import { topicTable } from '@data/db/schemas/topic'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { messageService } from '@data/services/MessageService'
import { generateOrderKeySequence } from '@data/services/utils/orderKey'
import { DataApiError } from '@shared/data/api/errors'
import type { MessageData } from '@shared/data/types/message'
import { createUniqueModelId } from '@shared/data/types/model'
import { createClearContextPart } from '@shared/data/types/uiParts'
import { setupTestDatabase } from '@test-helpers/db'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'

function partsText(content: string): MessageData {
  return { parts: [{ type: 'text', text: content }] as MessageData['parts'] }
}

function partsWithClearBoundary(content: string): MessageData {
  return {
    parts: [{ type: 'text', text: content }, createClearContextPart()] as MessageData['parts']
  }
}

describe('MessageService.getExportTree', () => {
  const dbh = setupTestDatabase()
  const modelAId = createUniqueModelId('provider-x', 'model-A')
  const modelBId = createUniqueModelId('provider-x', 'model-B')

  beforeEach(async () => {
    const [providerKey, modelAKey, modelBKey] = generateOrderKeySequence(3)
    await dbh.db
      .insert(userProviderTable)
      .values([{ providerId: 'provider-x', name: 'Provider X', orderKey: providerKey }])
    await dbh.db.insert(userModelTable).values([
      {
        id: modelAId,
        providerId: 'provider-x',
        modelId: 'model-A',
        presetModelId: 'model-A',
        name: 'model-A',
        isEnabled: true,
        isHidden: false,
        orderKey: modelAKey
      },
      {
        id: modelBId,
        providerId: 'provider-x',
        modelId: 'model-B',
        presetModelId: 'model-B',
        name: 'model-B',
        isEnabled: true,
        isHidden: false,
        orderKey: modelBKey
      }
    ])
  })

  async function seedTopicWithRoot(topicId: string, name = 'Export topic') {
    await dbh.db.insert(topicTable).values({ id: topicId, name, activeNodeId: null, orderKey: 'a0' })
    return messageService.createRootMessageTx(dbh.db, topicId)
  }

  async function setActive(topicId: string, messageId: string) {
    await dbh.db.update(topicTable).set({ activeNodeId: messageId }).where(eq(topicTable.id, topicId))
  }

  it('assembles trunk with folded variants and recursive branches from a full-featured tree', async () => {
    const topicId = 'topic-export-full'
    const rootId = await seedTopicWithRoot(topicId, 'Branch export')

    // Trunk: U1 → A1(+multi-model variant) → U2 → A2 → U3 → A3
    const u1 = messageService.create(topicId, {
      parentId: rootId,
      role: 'user',
      data: partsText('什么是黑洞?'),
      status: 'success'
    })
    const a1 = messageService.create(topicId, {
      parentId: u1.id,
      role: 'assistant',
      data: partsText('黑洞回答'),
      status: 'success',
      modelId: modelAId,
      siblingsGroupId: 900
    })
    const a1m = messageService.create(topicId, {
      parentId: u1.id,
      role: 'assistant',
      data: partsText('B 模型回答'),
      status: 'success',
      modelId: modelBId,
      siblingsGroupId: 900
    })
    const u2 = messageService.create(topicId, {
      parentId: a1.id,
      role: 'user',
      data: partsText('质量多大?'),
      status: 'success'
    })
    const a2 = messageService.create(topicId, {
      parentId: u2.id,
      role: 'assistant',
      data: partsText('质量回答'),
      status: 'success'
    })
    // Context-boundary message sits off the active path and must never surface
    messageService.create(topicId, {
      parentId: a2.id,
      role: 'user',
      data: partsWithClearBoundary('旧上下文'),
      status: 'success'
    })
    const u3 = messageService.create(topicId, {
      parentId: a2.id,
      role: 'user',
      data: partsText('总结一下'),
      status: 'success'
    })
    const a3 = messageService.create(topicId, {
      parentId: u3.id,
      role: 'assistant',
      data: partsText('总结回答'),
      status: 'success'
    })

    // Branch off A2 through a reserved (blank) connector: Uq → Ab1(+2 regenerate variants),
    // then a fork below Ab1 into two sub-directions (nested child branch + newest main chain)
    const blank1 = messageService.reserveBranch(a2.id, false)
    const uq = messageService.create(topicId, {
      parentId: blank1.id,
      role: 'user',
      data: partsText('怎么观测?'),
      status: 'success'
    })
    const ab1 = messageService.create(topicId, {
      parentId: uq.id,
      role: 'assistant',
      data: partsText('观测回答'),
      status: 'success'
    })
    const ab1s1 = messageService.createSibling(ab1.id, partsText('观测旧版一'))
    const ab1s2 = messageService.createSibling(ab1.id, partsText('观测旧版二'))
    const blank2 = messageService.reserveBranch(ab1.id, false)
    const uq2 = messageService.create(topicId, {
      parentId: blank2.id,
      role: 'user',
      data: partsText('追问观测细节?'),
      status: 'success'
    })
    const ab2 = messageService.create(topicId, {
      parentId: uq2.id,
      role: 'assistant',
      data: partsText('细节回答'),
      status: 'success'
    })
    const blank3 = messageService.reserveBranch(ab1.id, false)
    const uq3 = messageService.create(topicId, {
      parentId: blank3.id,
      role: 'user',
      data: partsText('换个思路?'),
      status: 'success'
    })
    const ab3 = messageService.create(topicId, {
      parentId: uq3.id,
      role: 'assistant',
      data: partsText('思路回答'),
      status: 'success'
    })

    await setActive(topicId, a3.id)

    const tree = messageService.getExportTree(topicId)

    // Trunk follows the active path, exactly
    expect(tree.trunk.map((t) => t.message.id)).toEqual([u1.id, a1.id, u2.id, a2.id, u3.id, a3.id])
    expect(tree.topicName).toBe('Branch export')

    // Multi-model variant folds behind its chain member
    expect(tree.trunk[1].variants).toHaveLength(1)
    expect(tree.trunk[1].variants[0].messageId).toBe(a1m.id)
    expect(tree.trunk[1].variants[0].source).toBe('multi-model')

    // One top-level branch, forking at A2, starting past the invisible blank connector
    expect(tree.branches).toHaveLength(1)
    const branch = tree.branches[0]
    expect(branch.branchId).toBe(uq.id)
    expect(branch.forkMessageId).toBe(a2.id)
    expect(branch.forkPreview).toContain('质量回答')
    expect(branch.firstUserQuestionPreview).toContain('怎么观测')
    // Whole branch subtree: chain + variants + nested children (blank connectors excluded)
    expect(branch.messageCount).toBe(8)

    // The newest fork below Ab1 continues the branch chain; the earlier one nests
    expect(branch.turns.map((t) => t.message.id)).toEqual([uq.id, ab1.id, uq3.id, ab3.id])
    expect(branch.turns[1].variants.map((v) => v.messageId)).toEqual([ab1s1.id, ab1s2.id])
    expect(branch.turns[1].variants.map((v) => v.source)).toEqual(['regenerate', 'regenerate'])
    expect(branch.children).toHaveLength(1)
    expect(branch.children[0].branchId).toBe(uq2.id)
    expect(branch.children[0].forkMessageId).toBe(ab1.id)
    expect(branch.children[0].turns.map((t) => t.message.id)).toEqual([uq2.id, ab2.id])

    // Stats: 2 branches total (top-level + nested), 15 renderable messages
    expect(tree.stats.branchCount).toBe(2)
    expect(tree.stats.totalMessageCount).toBe(15)
  })

  it('returns a plain trunk without branches for a linear topic with an edit-resend variant', async () => {
    const topicId = 'topic-export-linear'
    const rootId = await seedTopicWithRoot(topicId)
    const m1 = messageService.create(topicId, {
      parentId: rootId,
      role: 'user',
      data: partsText('问题一'),
      status: 'success'
    })
    const m2 = messageService.create(topicId, {
      parentId: m1.id,
      role: 'assistant',
      data: partsText('回答一'),
      status: 'success'
    })
    const m3 = messageService.create(topicId, {
      parentId: m2.id,
      role: 'user',
      data: partsText('问题二原版'),
      status: 'success'
    })
    const m3s = messageService.createSibling(m3.id, partsText('问题二改写'))
    const m4 = messageService.create(topicId, {
      parentId: m3s.id,
      role: 'assistant',
      data: partsText('回答二'),
      status: 'success'
    })

    await setActive(topicId, m4.id)

    const tree = messageService.getExportTree(topicId)

    // The newest sibling (m3s) is the active chain member; the original folds as edit-resend
    expect(tree.trunk.map((t) => t.message.id)).toEqual([m1.id, m2.id, m3s.id, m4.id])
    expect(tree.trunk[2].variants).toHaveLength(1)
    expect(tree.trunk[2].variants[0].messageId).toBe(m3.id)
    expect(tree.trunk[2].variants[0].source).toBe('edit-resend')
    expect(tree.branches).toHaveLength(0)
    // 4 chain turns + 1 folded variant — every renderable message counts
    expect(tree.stats).toEqual({ branchCount: 0, totalMessageCount: 5 })
  })

  it('throws not-found for an unknown topic', () => {
    expect(() => messageService.getExportTree('missing-topic')).toThrow(DataApiError)
  })

  it('returns an empty trunk for a topic with no active node', async () => {
    const topicId = 'topic-export-empty'
    await seedTopicWithRoot(topicId)
    const tree = messageService.getExportTree(topicId)
    expect(tree.trunk).toEqual([])
    expect(tree.branches).toEqual([])
    expect(tree.stats).toEqual({ branchCount: 0, totalMessageCount: 0 })
  })

  it('promotes a continued sibling variant into a branch forking at its cohort position', async () => {
    const topicId = 'topic-export-continued-variant'
    const rootId = await seedTopicWithRoot(topicId)
    const u1 = messageService.create(topicId, {
      parentId: rootId,
      role: 'user',
      data: partsText('问题'),
      status: 'success'
    })
    const a1 = messageService.create(topicId, {
      parentId: u1.id,
      role: 'assistant',
      data: partsText('当前版本'),
      status: 'success'
    })
    // A sibling the user continued under: childful, so it must fork as a branch
    // (not fold as a variant), with the fork at the shared parent position.
    const a1old = messageService.createSibling(a1.id, partsText('被继续的旧版本'))
    const u2 = messageService.create(topicId, {
      parentId: a1old.id,
      role: 'user',
      data: partsText('在旧版本下追问'),
      status: 'success'
    })
    const a2 = messageService.create(topicId, {
      parentId: u2.id,
      role: 'assistant',
      data: partsText('旧版本回答'),
      status: 'success'
    })
    const u3 = messageService.create(topicId, {
      parentId: a1.id,
      role: 'user',
      data: partsText('回到当前版本'),
      status: 'success'
    })
    const a3 = messageService.create(topicId, {
      parentId: u3.id,
      role: 'assistant',
      data: partsText('当前版本回答'),
      status: 'success'
    })

    await setActive(topicId, a3.id)

    const tree = messageService.getExportTree(topicId)

    expect(tree.trunk.map((t) => t.message.id)).toEqual([u1.id, a1.id, u3.id, a3.id])
    // The continued variant left the cohort and became a top-level branch
    expect(tree.trunk[1].variants).toHaveLength(0)
    expect(tree.branches).toHaveLength(1)
    const branch = tree.branches[0]
    expect(branch.branchId).toBe(a1old.id)
    expect(branch.forkMessageId).toBe(u1.id)
    expect(branch.turns.map((t) => t.message.id)).toEqual([a1old.id, u2.id, a2.id])
    expect(branch.firstUserQuestionPreview).toContain('在旧版本下追问')
    expect(tree.stats).toEqual({ branchCount: 1, totalMessageCount: 7 })
  })
})
