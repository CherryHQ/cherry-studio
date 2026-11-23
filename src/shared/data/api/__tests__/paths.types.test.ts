import { expectTypeOf, it } from 'vitest'

import type { MatchApiPath, ResponseForPath } from '../paths'
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
