# 0001. Record Architecture Decisions

- **Status:** Accepted
- **Date:** 2026-10-25
- **Deciders:** MarketPulse Core Team

---

## Context and Problem Statement

We need a systematic way to record significant architectural and design choices for MarketPulse Oracle, capturing the context, constraints, considered alternatives, and consequences.

---

## Decision Outcome

We choose to use Architecture Decision Records (ADRs) based on Michael Nygard's format, located in `docs/adr/`. Each ADR is sequentially numbered starting from `0000-template.md`.

### Consequences
- Architectural decisions are transparent and version-controlled.
- Deviations from the original specification in `README.md` must be documented and reviewed as an ADR before implementation.
- Preserves context for future maintainers and security auditors.
