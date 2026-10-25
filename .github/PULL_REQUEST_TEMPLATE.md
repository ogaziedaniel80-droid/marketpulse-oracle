## Summary of Changes

<!-- Briefly describe the purpose and content of this pull request. -->

## Conventional Commit Type

- [ ] `feat`: New feature or capability
- [ ] `fix`: Bug fix
- [ ] `docs`: Documentation update
- [ ] `test`: Adding or updating tests
- [ ] `chore`: Build/tooling/dependency updates

## Contract Change Checklist

<!-- Required if this PR modifies any crate in contracts/ -->

- [ ] Updated unit and property tests covering all modified code paths
- [ ] Regenerated TypeScript contract bindings (`pnpm bindings:generate`)
- [ ] Documented changes in [`docs/contracts-changelog.md`](../docs/contracts-changelog.md)
- [ ] Checked against storage TTL and budget limits in [`docs/contracts-storage.md`](../docs/contracts-storage.md)
- [ ] Recorded gas and resource benchmarks or wasm size in [`docs/versions.md`](../docs/versions.md)
- [ ] Two maintainer reviews requested for contract changes

## Product & Security Guardrails

- [ ] Mechanism preserved: commit -> reveal -> median -> payouts/slashing -> challenge
- [ ] No personal data on-chain (only hashes, coarse market geohashes, aggregates)
- [ ] Auth checks: every state-changing contract function calls `require_auth()`
- [ ] Zero secrets committed (.env.example used with empty secrets)
- [ ] CI is passing: format, clippy/eslint, tests
