
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

## APIs

- `Bun.serve()` supports WebSockets, HTTPS, and routes. Don't use `express`.
- `bun:sqlite` for SQLite. Don't use `better-sqlite3`.
- `Bun.redis` for Redis. Don't use `ioredis`.
- `Bun.sql` for Postgres. Don't use `pg` or `postgres.js`.
- `WebSocket` is built-in. Don't use `ws`.
- Prefer `Bun.file` over `node:fs`'s readFile/writeFile
- Bun.$`ls` instead of execa.

## Testing

Use `bun test` to run tests.

```ts#index.test.ts
import { test, expect } from "bun:test";

test("hello world", () => {
  expect(1).toBe(1);
});
```

## Frontend

Use HTML imports with `Bun.serve()`. Don't use `vite`. HTML imports fully support React, CSS, Tailwind.

Server:

```ts#index.ts
import index from "./index.html"

Bun.serve({
  routes: {
    "/": index,
    "/api/users/:id": {
      GET: (req) => {
        return new Response(JSON.stringify({ id: req.params.id }));
      },
    },
  },
  // optional websocket support
  websocket: {
    open: (ws) => {
      ws.send("Hello, world!");
    },
    message: (ws, message) => {
      ws.send(message);
    },
    close: (ws) => {
      // handle close
    }
  },
  development: {
    hmr: true,
    console: true,
  }
})
```

HTML files can import .tsx, .jsx or .js files directly and Bun's bundler will transpile & bundle automatically. `<link>` tags can point to stylesheets and Bun's CSS bundler will bundle.

```html#index.html
<html>
  <body>
    <h1>Hello, world!</h1>
    <script type="module" src="./frontend.tsx"></script>
  </body>
</html>
```

With the following `frontend.tsx`:

```tsx#frontend.tsx
import React from "react";
import { createRoot } from "react-dom/client";

// import .css files directly and it works
import './index.css';

const root = createRoot(document.body);

export default function Frontend() {
  return <h1>Hello, world!</h1>;
}

root.render(<Frontend />);
```

Then, run index.ts

```sh
bun --hot ./index.ts
```

For more information, read the Bun API docs in `node_modules/bun-types/docs/**.mdx`.
