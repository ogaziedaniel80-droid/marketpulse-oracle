# Runbook: Security & Data Quality Incident Response

**Companion Specification:** `README.md` Section 13 & Section 23.  
**Contact:** `security@<your-domain>` (`docs/SECURITY.md`)

---

## 1. Severity Classification

| Severity          | Definition                                                                              | Response SLA                                                               |
| ----------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| **P0 (Critical)** | Smart contract exploit, escrow drain risk, or admin/arbiter key compromise              | Immediate (< 15 min): Execute [`pause-procedure.md`](./pause-procedure.md) |
| **P1 (High)**     | Coordinated Sybil cartel biasing finalised observations, or Relayer/RPC outage > 30 min | < 1 hour: Trigger emergency dispute & rotate RPC/Relayer                   |
| **P2 (Medium)**   | Elevated outlier slash rate (> 25%) due to sudden FX/commodity shock                    | < 4 hours: Review tolerance band in `docs/parameter-log.md`                |

## 2. Triage & Containment Workflow

1. **Contain:** If on-chain funds or oracle integrity are threatened, pause new requests (`pause-procedure.md`) and challenge any unfinalised tainted observations via `Disputes::challenge`.
2. **Investigate:** Run `analytics/src/pipeline.py` to identify common funding sources (`correlation_cluster`) and synchronized commit bursts (`timing_suspicious`).
3. **Remediate:** Suspend confirmed Sybil wallets (`POST /v1/admin/reporters/:id/suspend`), uphold fraud disputes (`Disputes::rule`), and document the post-mortem in `docs/contracts-changelog.md`.
