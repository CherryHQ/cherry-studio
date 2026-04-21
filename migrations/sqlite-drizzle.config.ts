import { defineConfig } from 'drizzle-kit'
export default defineConfig({
  out: './migrations/sqlite-drizzle',
  // Only pick up direct schema files; explicitly skip `__tests__/` siblings
  // whose test files use TS path aliases drizzle-kit cannot resolve.
  schema: ['./src/main/data/db/schemas/*.ts', '!./src/main/data/db/schemas/**/*.test.ts'],
  dialect: 'sqlite',
  casing: 'snake_case'
})
