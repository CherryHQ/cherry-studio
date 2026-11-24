export type ItemKey<T, TId> =
  | (keyof T & keyof { [K in keyof T as T[K] extends TId ? K : never]: T[K] })
  | ((item: T) => TId)
