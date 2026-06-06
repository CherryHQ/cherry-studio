import type { JSONObject } from '@ai-sdk/provider'
import { describe, expectTypeOf, it } from 'vitest'

import type { RuntimeExecutor } from '../executor'
import type { RerankParams, RerankResult } from '../types'

describe('Runtime rerank types', () => {
  it('defaults rerank documents to string', () => {
    type Document = RerankResult['ranking'][number]['document']

    expectTypeOf<Document>().toEqualTypeOf<string>()
  })

  it('preserves object document generics', () => {
    type DocumentValue = JSONObject & { text: string }
    type Document = RerankResult<DocumentValue>['ranking'][number]['document']

    expectTypeOf<Document>().toEqualTypeOf<DocumentValue>()
  })

  it('preserves object document generics on RuntimeExecutor.rerank', () => {
    type DocumentValue = JSONObject & { text: string }

    expectTypeOf<RuntimeExecutor['rerank']>().toMatchTypeOf<
      (params: RerankParams<DocumentValue>) => Promise<RerankResult<DocumentValue>>
    >()
  })
})
