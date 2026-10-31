import { startCoreWorker, type WorkerScope } from '../src/worker/startCoreWorker'

startCoreWorker(self as unknown as WorkerScope)
