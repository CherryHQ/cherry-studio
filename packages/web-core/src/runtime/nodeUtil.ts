// Browser `node:util` subset used by the data services. The compared values are
// JSON column data, where structural equality matches Node's strict comparison.
export { isEqual as isDeepStrictEqual } from 'es-toolkit'
