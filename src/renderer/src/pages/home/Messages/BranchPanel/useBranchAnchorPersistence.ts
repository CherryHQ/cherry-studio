import { useMutation } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useCallback, useEffect } from 'react'

import { buildCreateBranchAnchorBody, shouldWriteBranchAnchorOnce } from './branchAnchorWrite'
import type { Branch } from './types'

const logger = loggerService.withContext('BranchAnchorPersistence')

interface UseBranchAnchorPersistenceArgs {
  parentTopicId: string
  branches: Branch[]
}

export function useBranchAnchorPersistence({ parentTopicId, branches }: UseBranchAnchorPersistenceArgs): void {
  const { trigger: createBranchAnchor } = useMutation('POST', '/branch-anchors')

  const persistBranchAnchorIfReady = useCallback(
    (branch: Branch) => {
      const body = buildCreateBranchAnchorBody(parentTopicId, branch)
      if (!body) return

      if (!shouldWriteBranchAnchorOnce(branch)) return

      void createBranchAnchor({ body })
        .then((anchor) => {
          logger.debug('Created branch anchor for kept branch', {
            anchorId: anchor.id,
            branchId: branch.id,
            branchTopicId: body.branchTopicId,
            parentTopicId: body.parentTopicId
          })
        })
        .catch((error) => {
          logger.error('Failed to create branch anchor for kept branch', error as Error, {
            branchId: branch.id,
            branchTopicId: body.branchTopicId,
            parentTopicId: body.parentTopicId
          })
        })
    },
    [createBranchAnchor, parentTopicId]
  )

  useEffect(() => {
    branches.forEach((branch) => persistBranchAnchorIfReady(branch))
  }, [branches, persistBranchAnchorIfReady])
}
