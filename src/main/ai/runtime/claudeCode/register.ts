import { runtimeDriverRegistry } from '../registry'
import { ClaudeCodeRuntimeDriver } from './ClaudeCodeRuntimeDriver'

runtimeDriverRegistry.register(new ClaudeCodeRuntimeDriver())
