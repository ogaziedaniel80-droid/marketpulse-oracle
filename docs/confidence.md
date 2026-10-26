# Confidence Score Formula

**File:** `docs/confidence.md`  
**Applies to:** `ReportEngine::resolve()` — the `confidence_bps` field of `Observation`.

---

## Purpose

`confidence_bps` is a dimensionless measure (0–10 000 bps, where 10 000 = 100%) of
how much an on-chain consumer should trust the resolved observation. It combines two
independent signals:

1. **Agreement** — what fraction of reporter weight agreed on the median value.
2. **Quorum** — how many reports were accepted relative to the minimum required.

On-chain consumers (README section 20) are expected to gate on `confidence_bps ≥ 7 000`
before acting.

---

## Formula

### Step 1 — Agreement basis points

```
agreement_bps = min(total_accepted_weight * 10_000 / total_weight, 10_000)
```

- `total_accepted_weight` — sum of `weight_bps` values for all reporters whose
  revealed value is within `tolerance_bps` of the weighted median.
- `total_weight` — sum of `weight_bps` values for **all** revealed reporters
  (accepted + outliers).

This is the weight-adjusted fraction of reporters that agreed. Because weights
reflect reputation tiers (README section 8.1), a senior reporter's agreement
counts more than a newcomer's.

### Step 2 — Quorum basis points

```
quorum_bps = min(n_accepted * 10_000 / min_reports, 10_000)
```

- `n_accepted` — count of accepted reports.
- `min_reports` — the minimum report count configured on the request.

This factor penalises observations that barely met quorum (e.g. only 3 reports
when 15 were expected) relative to those with full coverage.

### Step 3 — Combined confidence

```
confidence_bps = min(agreement_bps * quorum_bps / 10_000, 10_000)
```

This is the truncated geometric mean of the two factors, keeping the result in
the `[0, 10_000]` range using integer arithmetic.

---

## Examples

| Scenario | agreement_bps | quorum_bps | confidence_bps |
|---|---|---|---|
| 15/15 reports accepted, all equal weight | 10 000 | 10 000 | 10 000 |
| 12/15 accepted, equal weight | 8 000 | 10 000 | 8 000 |
| 5/5 accepted (min=5), all equal weight | 10 000 | 10 000 | 10 000 |
| 3/5 accepted (min=5), equal weight | 6 000 | 6 000 | 3 600 |
| 5/5 accepted but 1 outlier had 50% weight | 6 667 | 10 000 | 6 667 |

---

## Rationale

- Integer-only arithmetic: no floating point, no rounding traps.
- Monotone: adding an accepted report never decreases confidence.
- Conservative: a low-quorum or low-agreement observation scores low, even if the
  few reporters that did participate agreed perfectly.
- Bounded: result is always in `[0, 10_000]`.

---

## Consumer guidance (README section 20)

```rust
assert!(obs.confidence_bps >= 7_000, "low confidence");
assert!(obs.n_reports >= 5, "too few reports");
assert!(now - obs.finalised_at <= 86_400, "stale");
```

For parametric insurance triggers (README section 21), use `≥ 8 000` and require
two consecutive observations to match.
