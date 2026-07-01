import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import type { CreateBranchAnchorDto } from '@shared/data/api/schemas/branchAnchors'
import type { BranchAnchor as PersistedBranchAnchorDto } from '@shared/data/types/branchAnchor'
import { useCallback, useEffect, useRef } from 'react'

import {
  buildCreateBranchAnchorBody,
  claimBranchAnchorCreate,
  claimBranchAnchorDelete,
  clearBranchAnchorCreateGuard,
  getBranchAnchorTopicKey,
  markBranchAnchorCreated,
  markBranchAnchorDeleted,
  markBranchAnchorDeleteFailed
} from './branchAnchorWrite'
import type { Branch } from './types'

const logger = loggerService.withContext('BranchAnchorPersistence')

interface UseBranchAnchorPersistenceArgs {
  parentTopicId: string
  branches: Branch[]
  onAnchorCreated?: (anchor: PersistedBranchAnchorDto) => void
  onAnchorDeleted?: (anchorId: string) => void
}

export function useBranchAnchorPersistence({
  parentTopicId,
  branches,
  onAnchorCreated,
  onAnchorDeleted
}: UseBranchAnchorPersistenceArgs): void {
  const { trigger: createBranchAnchor } = useMutation('POST', '/branch-anchors')
  const { trigger: deleteBranchAnchor } = useMutation('DELETE', '/branch-anchors/:id')
  const latestDesiredKeptByTopicIdRef = useRef(new Map<string, boolean>())
  const latestCreateBodyByTopicIdRef = useRef(new Map<string, CreateBranchAnchorDto>())
  const latestBranchIdByTopicIdRef = useRef(new Map<string, string>())
  const reconcileBranchTopicRef = useRef<(branchTopicId: string) => void>(() => undefined)

  const startCreateBranchAnchor = useCallback(
    (body: CreateBranchAnchorDto) => {
      const branchTopicId = body.branchTopicId
      if (!claimBranchAnchorCreate(branchTopicId)) return

      void createBranchAnchor({ body })
        .then((anchor) => {
          markBranchAnchorCreated(branchTopicId, anchor.id)
          onAnchorCreated?.(anchor)
          logger.debug('Created branch anchor for kept branch', {
            anchorId: anchor.id,
            branchId: latestBranchIdByTopicIdRef.current.get(branchTopicId),
            branchTopicId: body.branchTopicId,
            parentTopicId: body.parentTopicId
          })

          if (latestDesiredKeptByTopicIdRef.current.get(branchTopicId) !== true) {
            reconcileBranchTopicRef.current(branchTopicId)
          }
        })
        .catch((error) => {
          clearBranchAnchorCreateGuard(branchTopicId)
          logger.warn('Failed to create branch anchor for kept branch', error as Error, {
            branchId: latestBranchIdByTopicIdRef.current.get(branchTopicId),
            branchTopicId: body.branchTopicId,
            parentTopicId: body.parentTopicId
          })
        })
    },
    [createBranchAnchor, onAnchorCreated]
  )

  const startDeleteBranchAnchor = useCallback(
    (branchTopicId: string) => {
      const anchorId = claimBranchAnchorDelete(branchTopicId)
      if (!anchorId) return

      void deleteBranchAnchor({ params: { id: anchorId } })
        .then(() => {
          markBranchAnchorDeleted(branchTopicId, anchorId)
          onAnchorDeleted?.(anchorId)
          logger.debug('Deleted branch anchor for unkept branch', {
            anchorId,
            branchId: latestBranchIdByTopicIdRef.current.get(branchTopicId),
            branchTopicId
          })

          if (latestDesiredKeptByTopicIdRef.current.get(branchTopicId) === true) {
            reconcileBranchTopicRef.current(branchTopicId)
          }
        })
        .catch((error) => {
          markBranchAnchorDeleteFailed(branchTopicId, anchorId)
          logger.warn('Failed to delete branch anchor for unkept branch', error as Error, {
            anchorId,
            branchId: latestBranchIdByTopicIdRef.current.get(branchTopicId),
            branchTopicId
          })
        })
    },
    [deleteBranchAnchor, onAnchorDeleted]
  )

  const reconcileBranchTopic = useCallback(
    (branchTopicId: string) => {
      if (latestDesiredKeptByTopicIdRef.current.get(branchTopicId) === true) {
        const body = latestCreateBodyByTopicIdRef.current.get(branchTopicId)
        if (body) {
          startCreateBranchAnchor(body)
        }
        return
      }

      startDeleteBranchAnchor(branchTopicId)
    },
    [startCreateBranchAnchor, startDeleteBranchAnchor]
  )

  reconcileBranchTopicRef.current = reconcileBranchTopic

  useEffect(() => {
    branches.forEach((branch) => {
      const branchTopicId = getBranchAnchorTopicKey(branch)
      if (!branchTopicId) return

      latestDesiredKeptByTopicIdRef.current.set(branchTopicId, branch.disposition === 'kept')
      latestBranchIdByTopicIdRef.current.set(branchTopicId, branch.id)

      const body = buildCreateBranchAnchorBody(parentTopicId, branch)
      if (body) {
        latestCreateBodyByTopicIdRef.current.set(branchTopicId, body)
      }

      reconcileBranchTopic(branchTopicId)
    })
  }, [branches, parentTopicId, reconcileBranchTopic])
}
