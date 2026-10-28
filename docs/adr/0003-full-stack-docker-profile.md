# ADR 0003: Full-Stack Docker Compose Profile (`--profile full`)

- **Status:** Accepted
- **Date:** 2026-10-28

## Context

`README.md` Section 14.3 defines `docker compose -f infra/docker/compose.dev.yml up -d` to launch the core backing infrastructure (`postgres`, `redis`, `minio`) while developers run application services via `pnpm dev`. However, for one-command integration testing and contributor onboarding, operators also need a single Docker Compose invocation that brings up the entire stack (`postgres`, `redis`, `minio`, `api`, `worker`, `web`, and `evidence-check`).

## Decision

We retain `postgres`, `redis`, and `minio` as the default profile in `infra/docker/compose.dev.yml` (preserving 100% compatibility with `README.md` Section 14.3) and add the `full` profile (`profiles: ['full']`) for `api`, `worker`, `web`, and `evidence-check`.

- Infrastructure only: `docker compose -f infra/docker/compose.dev.yml up -d`
- Full stack in one command: `docker compose -f infra/docker/compose.dev.yml --profile full up -d`

## Consequences

- Zero breaking changes to the existing `README.md` quickstart commands.
- CI and contributors can spin up all 7 containers with a single `--profile full` flag.
