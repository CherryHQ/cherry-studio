/** Runtime-specific worker initialization for capabilities backed by onnxruntime-node. */
export const onnxRuntimeWorkerSource = `
RUNTIME_INITIALIZERS.push((msg) => {
  const bindingPath = msg.artifactPaths && msg.artifactPaths['onnxruntime-node']
  if (bindingPath) process.env.CHERRY_ONNXRUNTIME_BINDING_PATH = bindingPath
})
`
