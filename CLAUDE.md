
## Design Principles

- **Functional Domain Modeling**: Pure core / impure shell. Keep business logic in pure functions under `src/core/`, side effects in `src/shell/`.
  - Push IO to the edges of use cases. Use-case functions return pure results (e.g. `RenameOutcome` discriminated union). Actual IO (console output, file writes, `process.exit`) happens only in a single IO boundary function (`handleOutcome`).
  - Write unit tests for all pure functions. Test every function in `src/core/` and the formatting/parsing functions in `src/shell/output.ts` under `tests/`.
- **Effective TypeScript**: Follow the principles from "Effective TypeScript" by Dan Vanderkam.
  - Prefer narrowing over type assertions (`as`). Use branded type constructors (`toTypeName()`, `toFilePath()`, etc.) instead of `as TypeName`.
  - Avoid `any`. Use `unknown` + `instanceof` or type guards instead.
  - Avoid non-null assertions (`!`). Use early returns, conditional assignment, or `Map.get()` with `if/else`.
  - Use `as const` for literal arrays/objects.
  - Add JSDoc to all functions and types with description, `@precondition`, and `@postcondition`. Use `@invariant` for data types.
  - Use discriminated unions for domain types (see `src/types/domain.ts`).
  - Use `Result<T, E>` instead of throwing exceptions (see `src/types/result.ts`).
  - Prefer `readonly` for function parameters and return types.
  - Comments in English.

## Runtime

Default to using Bun instead of Node.js.

- Use `bun <file>` instead of `node <file>` or `ts-node <file>`
- Use `bun test` instead of `jest` or `vitest`
- Use `bun build <file.html|file.ts|file.css>` instead of `webpack` or `esbuild`
- Use `bun install` instead of `npm install` or `yarn install` or `pnpm install`
- Use `bun run <script>` instead of `npm run <script>` or `yarn run <script>` or `pnpm run <script>`
- Use `bunx <package> <command>` instead of `npx <package> <command>`
- Bun automatically loads .env, so don't use dotenv.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```
