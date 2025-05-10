import '@testing-library/jest-dom/vitest'

import { styleSheetSerializer } from 'jest-styled-components/serializer'
import { expect } from 'vitest'
expect.addSnapshotSerializer(styleSheetSerializer)
