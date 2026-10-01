# Contributing

Thanks for helping. Bijli Saathi is a small, solo-maintained project, so small focused PRs land fastest.

## Setup

```sh
bun install          # bun only: don't use npm/pnpm (no npm lockfile)
bun run typecheck
bun test
bunx expo run:android   # needs the Android SDK + JDK 17
```

Project layout and conventions are in [CLAUDE.md](CLAUDE.md) (it's written for coding agents, but it's
the shortest accurate map for humans too).

## Rules of thumb

- Never log, store or send a user's credentials, token or account data anywhere except UPPCL.
- Don't commit real account numbers, phone numbers, names, addresses, tokens or screenshots of a real
  account. CI scans for personal data and fails the build.
- Every user-visible string goes in both `messages/en.json` and `messages/hi.json` under `"app"`.
- Keep `expo*` packages on `~57.0.0`-style ranges.
- **Dev tools** (fake-data test scenarios) live in `src/dev`, run in dev builds only, and are removable
  with `scripts/remove-dev-tools.sh`. Main code touches them only through one-line hooks tagged
  `@dev-tools`; keep it that way (CI deletes them and requires the app to still typecheck).
  Use a scenario (Settings → Developer → Test scenario, dev builds) to check screens a real account can't reach.
- Tests live in `tests/`; nothing test-only goes into app code.

## Bugs

Open an issue with the bug template. The most useful thing you can paste is the text from
**Details → Copy details** on the error screen: it says which system failed (UPPCL SMART, bill portal,
1912 portal, or the app) and UPPCL's own error. Check it doesn't contain anything you'd rather not share.

## Pull requests

Branch `fix/<short-desc>` or `feat/<short-desc>`, conventional commit messages, and say in the PR how you
verified it. `bun run typecheck` and `bun test` must pass.
