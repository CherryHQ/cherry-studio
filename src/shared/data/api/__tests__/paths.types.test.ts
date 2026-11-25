import { expectTypeOf, it } from 'vitest'

import type { MatchApiPath, ResolvedPath, ResponseForPath } from '../paths'
import type { ApiSchemas } from '../schemas/apiSchemas'

it('matches complete route segments without treating descendants as provider IDs', () => {
  expectTypeOf<
    MatchApiPath<'/providers/openai/models:resolve'>
  >().toEqualTypeOf<'/providers/:providerId/models:resolve'>()
  expectTypeOf<
    MatchApiPath<`/providers/${string}/models:resolve`>
  >().toEqualTypeOf<'/providers/:providerId/models:resolve'>()
  expectTypeOf<MatchApiPath<'/providers/openai'>>().toEqualTypeOf<'/providers/:providerId'>()
  expectTypeOf<MatchApiPath<'/providers/openai/models:resolve/extra'>>().toEqualTypeOf<never>()
  expectTypeOf<ResponseForPath<`/providers/${string}/models:resolve`, 'GET'>>().toEqualTypeOf<
    ApiSchemas['/providers/:providerId/models:resolve']['GET']['response']
  >()
})

it('resolves adjacent parameters and retains literal suffix segments', () => {
  expectTypeOf<
    ResolvedPath<'/prompt-bindings/:targetType/:targetId'>
  >().toEqualTypeOf<`/prompt-bindings/${string}/${string}`>()
  expectTypeOf<
    ResolvedPath<'/items/:id/actions/:action/result'>
  >().toEqualTypeOf<`/items/${string}/actions/${string}/result`>()
  expectTypeOf<ResolvedPath<'/providers'>>().toEqualTypeOf<'/providers'>()
  expectTypeOf<
    MatchApiPath<'/prompt-bindings/assistant/assistant-1'>
  >().toEqualTypeOf<'/prompt-bindings/:targetType/:targetId'>()
  expectTypeOf<ResponseForPath<`/prompt-bindings/assistant/${string}`, 'GET'>>().toEqualTypeOf<
    ApiSchemas['/prompt-bindings/:targetType/:targetId']['GET']['response']
  >()
})
