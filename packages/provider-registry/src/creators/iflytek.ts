import { defineCreator } from './types'

// iFlytek's own Spark models. No upstream source lists them, so the SKUs are hand-written from
// the Astron MaaS docs (context windows from the Token Plan model table).
export default defineCreator({
  id: 'iflytek',
  name: 'iFlytek (Spark)',
  idPrefixes: ['spark-x'],
  reasoningFamilies: [{ pattern: '^spark-x2' }],
  models: [
    {
      id: 'spark-x2-agent',
      name: 'Spark X2 Agent',
      capabilities: ['function-call', 'reasoning', 'structured-output'],
      contextWindow: 262_144
    },
    {
      id: 'spark-x2',
      name: 'Spark X2',
      capabilities: ['function-call', 'reasoning', 'structured-output'],
      contextWindow: 196_608
    },
    {
      id: 'spark-x2-flash',
      name: 'Spark X2 Flash',
      capabilities: ['function-call', 'reasoning', 'structured-output'],
      contextWindow: 262_144
    }
  ]
})
