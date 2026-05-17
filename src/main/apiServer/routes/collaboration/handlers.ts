import { loggerService } from '@logger'
import { collaborationRuntimeService, collaborationService, workerRuntimeService } from '@main/services/agents'
import type { Request, Response } from 'express'

const logger = loggerService.withContext('ApiServerCollaborationHandlers')

const internalError = (res: Response, message: string, code: string, error: unknown) => {
  logger.error(message, { error })
  return res.status(500).json({
    error: {
      message,
      type: 'internal_error',
      code
    }
  })
}

export const listWorkspaces = async (_req: Request, res: Response): Promise<Response> => {
  try {
    return res.json({ data: await collaborationService.listWorkspaces() })
  } catch (error) {
    return internalError(res, 'Failed to list collaboration workspaces', 'collab_workspaces_list_failed', error)
  }
}

export const createWorkspace = async (req: Request, res: Response): Promise<Response> => {
  try {
    return res.status(201).json(await collaborationService.createWorkspace(req.body))
  } catch (error) {
    return internalError(res, 'Failed to create collaboration workspace', 'collab_workspace_create_failed', error)
  }
}

export const listWorkers = async (_req: Request, res: Response): Promise<Response> => {
  try {
    return res.json({ data: await workerRuntimeService.listWorkers() })
  } catch (error) {
    return internalError(res, 'Failed to list collaboration workers', 'collab_workers_list_failed', error)
  }
}

export const reorderWorkers = async (req: Request, res: Response): Promise<Response> => {
  try {
    workerRuntimeService.setWorkerFamilyOrder(req.body.orderedKeys)
    return res.json({ data: await workerRuntimeService.listWorkers() })
  } catch (error) {
    return internalError(res, 'Failed to reorder collaboration workers', 'collab_workers_reorder_failed', error)
  }
}

export const bindWorker = async (req: Request, res: Response): Promise<Response> => {
  try {
    return res.status(201).json(await workerRuntimeService.bindWorker(req.params.workerType))
  } catch (error) {
    logger.warn('Failed to bind collaboration worker', {
      workerType: req.params.workerType,
      error: error instanceof Error ? error.message : String(error)
    })
    return res.status(400).json({
      error: {
        message: error instanceof Error ? error.message : 'Failed to bind worker',
        type: 'invalid_request_error',
        code: 'collab_worker_bind_failed'
      }
    })
  }
}

export const createWorkerInstance = async (req: Request, res: Response): Promise<Response> => {
  try {
    return res.status(201).json(await workerRuntimeService.createInstance(req.params.workerType))
  } catch (error) {
    logger.warn('Failed to create collaboration worker instance', {
      workerType: req.params.workerType,
      error: error instanceof Error ? error.message : String(error)
    })
    return res.status(400).json({
      error: {
        message: error instanceof Error ? error.message : 'Failed to create worker instance',
        type: 'invalid_request_error',
        code: 'collab_worker_instance_create_failed'
      }
    })
  }
}

export const getWorkspace = async (req: Request, res: Response): Promise<Response> => {
  try {
    const workspace = await collaborationService.getWorkspace(req.params.workspaceId)
    if (!workspace) {
      return res.status(404).json({
        error: {
          message: 'Collaboration workspace not found',
          type: 'not_found',
          code: 'collab_workspace_not_found'
        }
      })
    }
    return res.json(workspace)
  } catch (error) {
    return internalError(res, 'Failed to get collaboration workspace', 'collab_workspace_get_failed', error)
  }
}

export const updateWorkspace = async (req: Request, res: Response): Promise<Response> => {
  try {
    const workspace = await collaborationService.updateWorkspace(req.params.workspaceId, req.body)
    if (!workspace) {
      return res.status(404).json({
        error: {
          message: 'Collaboration workspace not found',
          type: 'not_found',
          code: 'collab_workspace_not_found'
        }
      })
    }
    return res.json(workspace)
  } catch (error) {
    return internalError(res, 'Failed to update collaboration workspace', 'collab_workspace_update_failed', error)
  }
}

export const listRooms = async (req: Request, res: Response): Promise<Response> => {
  try {
    const workspaceId = String(req.query.workspaceId || '')
    if (!workspaceId) {
      return res.status(400).json({
        error: {
          message: 'workspaceId query parameter is required',
          type: 'invalid_request_error',
          code: 'collab_workspace_id_required'
        }
      })
    }
    return res.json({ data: await collaborationService.listRooms(workspaceId) })
  } catch (error) {
    return internalError(res, 'Failed to list collaboration rooms', 'collab_rooms_list_failed', error)
  }
}

export const createRoom = async (req: Request, res: Response): Promise<Response> => {
  try {
    return res.status(201).json(await collaborationService.createRoom(req.body))
  } catch (error) {
    return internalError(res, 'Failed to create collaboration room', 'collab_room_create_failed', error)
  }
}

export const getRoom = async (req: Request, res: Response): Promise<Response> => {
  try {
    const room = await collaborationService.getRoom(req.params.roomId)
    if (!room) {
      return res.status(404).json({
        error: {
          message: 'Collaboration room not found',
          type: 'not_found',
          code: 'collab_room_not_found'
        }
      })
    }
    return res.json(room)
  } catch (error) {
    return internalError(res, 'Failed to get collaboration room', 'collab_room_get_failed', error)
  }
}

export const updateRoom = async (req: Request, res: Response): Promise<Response> => {
  try {
    const room = await collaborationService.updateRoom(req.params.roomId, req.body)
    if (!room) {
      return res.status(404).json({
        error: {
          message: 'Collaboration room not found',
          type: 'not_found',
          code: 'collab_room_not_found'
        }
      })
    }
    return res.json(room)
  } catch (error) {
    return internalError(res, 'Failed to update collaboration room', 'collab_room_update_failed', error)
  }
}

export const archiveRoom = async (req: Request, res: Response): Promise<Response> => {
  try {
    const room = await collaborationService.archiveRoom(req.params.roomId)
    if (!room) {
      return res.status(404).json({
        error: {
          message: 'Collaboration room not found',
          type: 'not_found',
          code: 'collab_room_not_found'
        }
      })
    }
    return res.json(room)
  } catch (error) {
    return internalError(res, 'Failed to archive collaboration room', 'collab_room_archive_failed', error)
  }
}

export const listRoomMembers = async (req: Request, res: Response): Promise<Response> => {
  try {
    return res.json({ data: await collaborationService.listRoomMembers(req.params.roomId) })
  } catch (error) {
    return internalError(res, 'Failed to list collaboration room members', 'collab_room_members_list_failed', error)
  }
}

export const createRoomMember = async (req: Request, res: Response): Promise<Response> => {
  try {
    return res.status(201).json(await collaborationService.addRoomMember({ roomId: req.params.roomId, ...req.body }))
  } catch (error) {
    return internalError(res, 'Failed to add collaboration room member', 'collab_room_member_create_failed', error)
  }
}

export const deleteRoomMember = async (req: Request, res: Response): Promise<Response> => {
  try {
    const removed = await collaborationService.removeRoomMember(
      req.params.roomId,
      req.params.memberType as 'user' | 'agent',
      req.params.memberId
    )
    if (!removed) {
      return res.status(404).json({
        error: {
          message: 'Collaboration room member not found',
          type: 'not_found',
          code: 'collab_room_member_not_found'
        }
      })
    }
    return res.status(204).send()
  } catch (error) {
    return internalError(res, 'Failed to remove collaboration room member', 'collab_room_member_delete_failed', error)
  }
}

export const listRoomMessages = async (req: Request, res: Response): Promise<Response> => {
  try {
    return res.json({ data: await collaborationService.listRoomMessages(req.params.roomId) })
  } catch (error) {
    return internalError(res, 'Failed to list collaboration room messages', 'collab_room_messages_list_failed', error)
  }
}

export const createRoomMessage = async (req: Request, res: Response): Promise<Response> => {
  try {
    const message = await collaborationService.createRoomMessage({ roomId: req.params.roomId, ...req.body })
    if (message.authorType === 'user' && message.intent === 'task') {
      collaborationRuntimeService.handleTaskMessage(req.params.roomId, message.id).catch((error) => {
        logger.warn('Failed to process collaboration task message', {
          roomId: req.params.roomId,
          messageId: message.id,
          error: error instanceof Error ? error.message : String(error)
        })
      })
    }
    return res.status(201).json(message)
  } catch (error) {
    return internalError(res, 'Failed to create collaboration room message', 'collab_room_message_create_failed', error)
  }
}

export const assignRoomAndRun = async (req: Request, res: Response): Promise<Response> => {
  try {
    return res.json(await collaborationRuntimeService.assignRoomAndRun(req.params.roomId, req.body))
  } catch (error) {
    logger.warn('Failed to assign and run collaboration room task', {
      roomId: req.params.roomId,
      error: error instanceof Error ? error.message : String(error)
    })
    return res.status(400).json({
      error: {
        message: error instanceof Error ? error.message : 'Failed to assign room task',
        type: 'invalid_request_error',
        code: 'collab_room_assign_and_run_failed'
      }
    })
  }
}

export const listRoomRuns = async (req: Request, res: Response): Promise<Response> => {
  try {
    return res.json({ data: await collaborationService.listRoomRuns(req.params.roomId) })
  } catch (error) {
    return internalError(res, 'Failed to list collaboration room runs', 'collab_room_runs_list_failed', error)
  }
}

export const createRoomRun = async (req: Request, res: Response): Promise<Response> => {
  try {
    return res.status(201).json(await collaborationService.createRoomRun({ roomId: req.params.roomId, ...req.body }))
  } catch (error) {
    return internalError(res, 'Failed to create collaboration room run', 'collab_room_run_create_failed', error)
  }
}

export const updateRoomRun = async (req: Request, res: Response): Promise<Response> => {
  try {
    const run = await collaborationService.updateRoomRun(req.params.runId, req.body)
    if (!run) {
      return res.status(404).json({
        error: {
          message: 'Collaboration room run not found',
          type: 'not_found',
          code: 'collab_room_run_not_found'
        }
      })
    }
    return res.json(run)
  } catch (error) {
    return internalError(res, 'Failed to update collaboration room run', 'collab_room_run_update_failed', error)
  }
}

export const stopRoomRun = async (req: Request, res: Response): Promise<Response> => {
  try {
    const stopped = await collaborationRuntimeService.stopRoomRun(req.params.runId)
    if (!stopped) {
      return res.status(404).json({
        error: {
          message: 'Collaboration room run not found',
          type: 'not_found',
          code: 'collab_room_run_not_found'
        }
      })
    }
    return res.status(202).json({ success: true })
  } catch (error) {
    return internalError(res, 'Failed to stop collaboration room run', 'collab_room_run_stop_failed', error)
  }
}

export const getRoomAutonomy = async (req: Request, res: Response): Promise<Response> => {
  try {
    return res.json(await collaborationRuntimeService.getRoomAutonomyState(req.params.roomId))
  } catch (error) {
    return internalError(res, 'Failed to get collaboration room autonomy', 'collab_room_autonomy_get_failed', error)
  }
}

export const updateRoomAutonomy = async (req: Request, res: Response): Promise<Response> => {
  try {
    return res.json(await collaborationRuntimeService.updateRoomAutonomy(req.params.roomId, req.body))
  } catch (error) {
    return internalError(
      res,
      'Failed to update collaboration room autonomy',
      'collab_room_autonomy_update_failed',
      error
    )
  }
}

export const runRoomAutonomyNow = async (req: Request, res: Response): Promise<Response> => {
  try {
    return res.json(await collaborationRuntimeService.runAutonomyNow(req.params.roomId))
  } catch (error) {
    return internalError(res, 'Failed to run collaboration room autonomy', 'collab_room_autonomy_run_failed', error)
  }
}

export const stopRoomAutonomy = async (req: Request, res: Response): Promise<Response> => {
  try {
    return res.json(await collaborationRuntimeService.stopRoomAutonomy(req.params.roomId))
  } catch (error) {
    return internalError(res, 'Failed to stop collaboration room autonomy', 'collab_room_autonomy_stop_failed', error)
  }
}
