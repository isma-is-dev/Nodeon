# ⚠️ DEPRECATED — TypeScript Compiler Sources

This `src-ts/` directory contains the **original TypeScript-based compiler** for Nodeon.

**It is no longer actively maintained.** The self-hosted compiler in `src-no/` is the primary implementation and receives all new features and bug fixes.

## Why keep it?

- **Bootstrap fallback**: If the self-hosted compiler ever breaks, this TS version can be used to rebuild it via `npm run build:bootstrap`.
- **Reference**: The TS source served as the blueprint for the `.no` rewrite.

## What to use instead

- **Self-hosted compiler**: `src-no/` (primary, actively maintained)
- **CLI binary**: `bin/nodeon-self.js` (`nodeon` command)
- **Build**: `npm run build` (uses self-hosted by default)

## Status

- Last synchronized with self-hosted: **March 2026** (generic type checking + interface conformance)
- New features added after this point will **only** be implemented in `src-no/`.
