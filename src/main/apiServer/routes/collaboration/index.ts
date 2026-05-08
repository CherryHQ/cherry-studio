import express from 'express'

import { handleValidationErrors } from '../agents/middleware'
import {
  archiveRoom,
  assignRoomAndRun,
  bindWorker,
  createRoom,
  createRoomMember,
  createRoomMessage,
  createRoomRun,
  createWorkerInstance,
  createWorkspace,
  deleteRoomMember,
  getRoom,
  getRoomAutonomy,
  getWorkspace,
  listRoomMembers,
  listRoomMessages,
  listRoomRuns,
  listRooms,
  listWorkers,
  listWorkspaces,
  reorderWorkers,
  runRoomAutonomyNow,
  stopRoomAutonomy,
  stopRoomRun,
  updateRoom,
  updateRoomAutonomy,
  updateRoomRun,
  updateWorkspace
} from './handlers'
import {
  validateAssignAndRun,
  validateCreateMember,
  validateCreateMessage,
  validateCreateRoom,
  validateCreateRun,
  validateCreateWorkspace,
  validateMemberIdentity,
  validateReorderWorkers,
  validateRoomId,
  validateRunId,
  validateUpdateRoom,
  validateUpdateRoomAutonomy,
  validateUpdateRun,
  validateUpdateWorkspace,
  validateWorkerType,
  validateWorkspaceId
} from './validators'

const collaborationRouter = express.Router()

collaborationRouter.get('/workers', listWorkers)
collaborationRouter.patch('/workers/order', validateReorderWorkers, handleValidationErrors, reorderWorkers)
collaborationRouter.post('/workers/:workerType/bind', validateWorkerType, handleValidationErrors, bindWorker)
collaborationRouter.post(
  '/workers/:workerType/instances',
  validateWorkerType,
  handleValidationErrors,
  createWorkerInstance
)

collaborationRouter.get('/workspaces', listWorkspaces)
collaborationRouter.post('/workspaces', validateCreateWorkspace, handleValidationErrors, createWorkspace)
collaborationRouter.get('/workspaces/:workspaceId', validateWorkspaceId, handleValidationErrors, getWorkspace)
collaborationRouter.patch(
  '/workspaces/:workspaceId',
  validateWorkspaceId,
  validateUpdateWorkspace,
  handleValidationErrors,
  updateWorkspace
)

collaborationRouter.get('/rooms', listRooms)
collaborationRouter.post('/rooms', validateCreateRoom, handleValidationErrors, createRoom)
collaborationRouter.get('/rooms/:roomId', validateRoomId, handleValidationErrors, getRoom)
collaborationRouter.patch('/rooms/:roomId', validateRoomId, validateUpdateRoom, handleValidationErrors, updateRoom)
collaborationRouter.post('/rooms/:roomId/archive', validateRoomId, handleValidationErrors, archiveRoom)

collaborationRouter.get('/rooms/:roomId/members', validateRoomId, handleValidationErrors, listRoomMembers)
collaborationRouter.post(
  '/rooms/:roomId/members',
  validateRoomId,
  validateCreateMember,
  handleValidationErrors,
  createRoomMember
)
collaborationRouter.delete(
  '/rooms/:roomId/members/:memberType/:memberId',
  validateMemberIdentity,
  handleValidationErrors,
  deleteRoomMember
)

collaborationRouter.get('/rooms/:roomId/messages', validateRoomId, handleValidationErrors, listRoomMessages)
collaborationRouter.post(
  '/rooms/:roomId/messages',
  validateRoomId,
  validateCreateMessage,
  handleValidationErrors,
  createRoomMessage
)
collaborationRouter.post(
  '/rooms/:roomId/assign-and-run',
  validateRoomId,
  validateAssignAndRun,
  handleValidationErrors,
  assignRoomAndRun
)

collaborationRouter.get('/rooms/:roomId/autonomy', validateRoomId, handleValidationErrors, getRoomAutonomy)
collaborationRouter.patch(
  '/rooms/:roomId/autonomy',
  validateRoomId,
  validateUpdateRoomAutonomy,
  handleValidationErrors,
  updateRoomAutonomy
)
collaborationRouter.post('/rooms/:roomId/autonomy/run-now', validateRoomId, handleValidationErrors, runRoomAutonomyNow)
collaborationRouter.post('/rooms/:roomId/autonomy/stop', validateRoomId, handleValidationErrors, stopRoomAutonomy)

collaborationRouter.get('/rooms/:roomId/runs', validateRoomId, handleValidationErrors, listRoomRuns)
collaborationRouter.post(
  '/rooms/:roomId/runs',
  validateRoomId,
  validateCreateRun,
  handleValidationErrors,
  createRoomRun
)
collaborationRouter.patch('/runs/:runId', validateRunId, validateUpdateRun, handleValidationErrors, updateRoomRun)
collaborationRouter.post('/runs/:runId/stop', validateRunId, handleValidationErrors, stopRoomRun)

export { collaborationRouter }
