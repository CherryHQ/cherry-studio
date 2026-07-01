import { runtimeDriverRegistry } from '../registry'
import { PiRuntimeDriver } from './PiRuntimeDriver'

runtimeDriverRegistry.register(new PiRuntimeDriver())
