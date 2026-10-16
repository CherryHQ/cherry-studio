import type { VoiceErrorReason } from '@shared/ipc/errors/voice'
import type { VoicePlaybackControl, VoicePlaybackState, VoiceSessionPhase } from '@shared/ipc/schemas/voice'
import type { InputFor } from '@shared/ipc/types'

import { VoiceRuntimeError } from './VoiceRuntimeError'

export type PlaybackState = Omit<VoicePlaybackState, 'availableCommands'>

export function createPlaybackState(): PlaybackState {
  return {
    attemptId: 0,
    commandRevision: 0,
    synthesis: 'idle',
    desired: 'playing',
    observed: 'empty',
    pendingCommand: null
  }
}

export function beginPlaybackSynthesis(state: PlaybackState): PlaybackState {
  return { ...state, synthesis: 'generating', observed: 'empty', failure: undefined }
}

export function completePlaybackSynthesis(state: PlaybackState): PlaybackState {
  return {
    ...state,
    attemptId: state.attemptId + 1,
    synthesis: 'completed',
    observed: 'ready',
    pendingCommand: state.desired === 'paused' ? 'pause' : 'resume'
  }
}

export function failPlayback(
  state: PlaybackState,
  stage: NonNullable<PlaybackState['failure']>['stage'],
  reason: VoiceErrorReason
): PlaybackState {
  return {
    ...state,
    ...(stage === 'synthesis' && { synthesis: 'failed' as const }),
    ...(stage === 'playback' && { observed: 'failed' as const }),
    pendingCommand: null,
    failure: { stage, reason }
  }
}

export function createPlaybackSnapshot(state: PlaybackState, hasOutput: boolean): VoicePlaybackState {
  const availableCommands: VoicePlaybackControl[] = ['stop']
  if (state.desired !== 'stopped') {
    if (state.failure) {
      if (hasOutput && state.failure.stage !== 'synthesis') availableCommands.unshift('retry')
    } else {
      availableCommands.unshift(state.desired === 'paused' ? 'resume' : 'pause')
    }
  }
  return { ...state, availableCommands }
}

export function applyPlaybackCommand(
  state: PlaybackState,
  command: VoicePlaybackControl,
  hasOutput: boolean
): PlaybackState {
  if (state.pendingCommand === command) return state
  if (!createPlaybackSnapshot(state, hasOutput).availableCommands.includes(command)) {
    throw new VoiceRuntimeError('invalid_request')
  }
  return {
    ...state,
    commandRevision: state.commandRevision + 1,
    desired: command === 'pause' ? 'paused' : command === 'stop' ? 'stopped' : 'playing',
    pendingCommand: command,
    failure: undefined,
    ...(command === 'retry' && { attemptId: state.attemptId + 1, observed: 'ready' as const })
  }
}

export function applyPlaybackReport(state: PlaybackState, report: InputFor<'ai.voice.playback.report'>): PlaybackState {
  if (report.attemptId !== state.attemptId) return state
  if (report.phase === 'failed') {
    if (state.desired === 'stopped' || state.failure?.stage === 'playback') return state
    return failPlayback(state, 'playback', report.reason ?? 'operation_failed')
  }
  if (report.phase === 'ended') {
    if (state.failure || state.desired === 'stopped' || state.observed === 'ended') return state
    return { ...state, observed: 'ended' }
  }
  if (report.commandRevision !== state.commandRevision) return state
  if (report.phase === 'stopped') {
    return state.desired === 'stopped' ? { ...state, pendingCommand: null } : state
  }
  if (state.failure || state.desired === 'stopped') return state
  if (report.phase === 'completed') return { ...state, observed: 'ended', pendingCommand: null }
  if (report.phase !== state.desired) return state
  return { ...state, observed: report.phase, pendingCommand: null }
}

export function playbackPhase(state: PlaybackState): Exclude<VoiceSessionPhase, 'idle'> {
  if (state.failure) return 'failed'
  if (state.observed === 'playing' || state.observed === 'paused') return state.observed
  if (state.synthesis === 'generating') return 'generating'
  return 'ready'
}
