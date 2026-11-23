const { EventEmitter } = require('node:events')
const { workerData } = require('node:worker_threads')

exports.watch = () => {
  const watcher = new EventEmitter()
  watcher.close = () => {
    const gate = new Int32Array(workerData.closeGate)
    Atomics.store(gate, 0, 1)
    Atomics.notify(gate, 0)
    Atomics.wait(gate, 1, 0, 5000)
    return Promise.resolve()
  }
  setImmediate(() => watcher.emit('ready'))
  return watcher
}
