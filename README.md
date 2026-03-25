# rgql

Type-safe GraphQL refactoring CLI tool. Renames types, fields, and fragments across GraphQL schema files and embedded queries in TypeScript/TSX — with full AST awareness, so `User.firstName` and `Product.firstName` in the same query are correctly distinguished.

Inspired by [ast-grep](https://ast-grep.github.io/) — a fantastic structural search/replace tool for general-purpose languages. We wanted the same power for GraphQL: AST-aware, type-safe refactoring that understands schema semantics, not just text patterns.

- Single binary (compiled with Bun)
- Follows [graphql-config](https://the-guild.dev/graphql/config) standard
- Dry-run by default — preview all changes before applying

## Install

```bash
# From source
bun install
bun run build    # produces ./rgql binary
```

## Quick Start

```bash
# Dry run (default) — shows what would change
rgql rename type User Account

# Apply changes
rgql rename type User Account --write

# Rename a field
rgql rename field User.firstName User.fullName --write

# Rename a fragment
rgql rename fragment UserBasic UserSummary --write
```

## Configuration

rgql uses [graphql-config](https://the-guild.dev/graphql/config). It searches for config files up the directory tree automatically.

```yaml
# graphql.config.yml — single project
schema: ./schema/**/*.graphql
documents: ./src/**/*.{ts,tsx}

# Multi-project (monorepo)
projects:
  frontend:
    schema: ./packages/frontend/schema/**/*.graphql
    documents: ./packages/frontend/src/**/*.{ts,tsx}
  admin:
    schema: ./packages/admin/schema/**/*.graphql
    documents: ./packages/admin/src/**/*.{ts,tsx}
```

Supported config file names (searched in order):

`graphql.config.yml`, `graphql.config.yaml`, `graphql.config.json`, `graphql.config.js`, `graphql.config.ts`, `.graphqlrc`, `.graphqlrc.yml`, `.graphqlrc.yaml`, `.graphqlrc.json`

## Commands

### `rename type <OldType> <NewType>`

Renames a GraphQL type across schema definitions and all document references (named types, fragment type conditions, inline fragments).

### `rename field <Type.oldField> <Type.newField>`

Renames a field on a specific type. Uses `TypeInfo` + `visitWithTypeInfo` from graphql-js to resolve parent types in queries, ensuring only the correct type's fields are renamed.

### `rename fragment <OldFragment> <NewFragment>`

Renames a fragment definition and all its spread usages.

## Global Flags

| Flag | Default | Description |
|---|---|---|
| `--config <path>` | auto-detect | Explicit path to graphql-config file |
| `--project <name>` | `default` | Project name for multi-project configs |
| `--write` | `false` | Apply changes to files (default: dry run) |
| `-i, --interactive` | `false` | Confirm each change individually |
| `--force` | `false` | Force breaking changes (e.g. interface cascade rename) |

## Output Modes

### Dry Run (default)

```
$ rgql rename field User.firstName User.fullName

🔍 Config: ./graphql.config.yml (project: default)
📂 Schema:    schema/**/*.graphql
📂 Documents: src/**/*.{ts,tsx}

Changes:
  schema/user.graphql:12  firstName → fullName  [schema]
  src/components/UserCard.tsx:34  firstName → fullName  (graphql`...`)  [document]

2 files, 2 occurrences
Dry run. Use --write to apply.
```

### Write Mode (`--write`)

```
$ rgql rename field User.firstName User.fullName --write

✓ schema/user.graphql:12
✓ src/components/UserCard.tsx:34

2 files, 2 occurrences updated.
```

### Interactive Mode (`-i`)

```
$ rgql rename field User.firstName User.fullName -i

[1/2] schema/user.graphql:12
  - firstName
  + fullName
Apply? [y/n/q]
```

## Interface Safety

When renaming a field defined on an interface, rgql detects the impact on implementing types:

- **Without `--force`**: Skips the rename and warns (exit code 2)
- **With `--force`**: Renames the field on the interface and all implementing types
- **With `-i`**: Prompts the user to confirm cascade rename

```
⚠️  Breaking change detected:
    'firstName' is defined on interface 'Node'
    The following types implement this interface:

    - User.firstName
    - Admin.firstName

Rename all of the above together? [y/n/q]
```

## Exit Codes

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Error (type not found, name collision, config missing, etc.) |
| `2` | Warning — partial skip (e.g. interface impact without `--force`) |

## Architecture

```
src/
├── types/
│   ├── domain.ts        # Branded types, discriminated unions, all domain data
│   └── result.ts        # Result<T, E> type
├── core/                # Pure functions — no IO
│   ├── pipeline.ts      # Main entry: computeRenamePlan()
│   ├── validate.ts      # Validation (type/field/fragment existence, collisions)
│   ├── rename-schema.ts # AST-based rename in .graphql schema files
│   ├── rename-document.ts # AST-based rename in queries (standalone + embedded)
│   ├── interface-check.ts # Interface impact detection
│   └── text-replace.ts  # Positional text replacement utility
├── shell/               # IO boundary
│   ├── cli.ts           # Commander.js commands, executeRename(), handleOutcome()
│   ├── config.ts        # graphql-config loading
│   ├── file-system.ts   # File reading, glob, writing
│   └── output.ts        # Pure formatting functions for CLI output
└── index.ts             # Entry point
```

**Design principles:**

- **Functional Domain Modeling** — Pure core / impure shell. Business logic in `src/core/` is pure; all IO is pushed to the edges in `src/shell/`. Use-case functions return a `RenameOutcome` discriminated union, and `handleOutcome()` is the single IO boundary.
- **Effective TypeScript** — Branded types, discriminated unions, `Result<T, E>`, no `as`/`any`/`!` assertions.
- **Contract-based documentation** — All functions have JSDoc with `@precondition` and `@postcondition`.

## Detected Query Patterns

| Pattern | Status |
|---|---|
| `` graphql`...` `` | Supported |
| `` gql`...` `` | Supported |
| Standalone `.graphql` / `.gql` files | Supported |
| `/* GraphQL */` comment | Planned |
| `# graphql` comment | Planned |

Embedded queries are extracted using `ts-morph` (TypeScript AST), not regex.

## Development

```bash
bun install          # Install dependencies
bun test             # Run tests
bun run typecheck    # TypeScript type checking
bun run lint         # Lint with oxlint
bun run fmt          # Format with oxfmt
bun run build        # Compile to single binary
```

## Tech Stack

| Role | Library |
|---|---|
| Runtime & build | [Bun](https://bun.sh) |
| CLI framework | [Commander.js](https://github.com/tj/commander.js) |
| GraphQL config | [graphql-config](https://the-guild.dev/graphql/config) |
| GraphQL AST | [graphql-js](https://github.com/graphql/graphql-js) |
| TypeScript AST | [ts-morph](https://ts-morph.com) |
| Linter | [oxlint](https://oxc.rs) |
| Formatter | [oxfmt](https://oxc.rs) |
