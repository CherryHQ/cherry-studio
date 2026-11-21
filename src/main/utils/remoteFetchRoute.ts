// Bounded fetches own their route and validated destination. The global proxy
// wrapper must not substitute an agent that re-resolves the destination.
export const REMOTE_FETCH_OWNS_ROUTE = Symbol('remoteFetchOwnsRoute')
