# Randomness and Assignment Protocol

**File:** `docs/randomness.md`  
**Applies to:** `Disputes` contract — panel selection; `ReportEngine` — reporter assignment.

Per README sections 4.1, 8.5, and 11: "Do not rely on `env.prng()` alone for
anything of value."

---

## 1. Why not env.prng() alone?

`env.prng()` in Soroban is seeded by the ledger's `base_fee` and `sequence_number`,
both of which are observable and potentially manipulable by a validator. For
high-value panel selections or reporter assignments this is insufficient.

---

## 2. Multi-party commit-reveal seed protocol

The `Disputes` contract implements a two-phase scheme where multiple registered
panel members (or the admin) contribute entropy:

### Phase 1 — Commit

Each contributor `C_i` chooses a random 32-byte `secret_i` and 32-byte `nonce_i`,
then submits:

```
commitment_i = sha256(secret_i || nonce_i)
```

via `Disputes::submit_seed_commitment(contributor, request_id, commitment_i)`.

The commitment is stored in temporary storage. Contributors cannot see each
other's secrets at this point.

### Phase 2 — Reveal

After all contributions are submitted, each contributor reveals via:

```
Disputes::reveal_seed(contributor, request_id, secret_i, nonce_i)
```

The contract verifies `sha256(secret_i || nonce_i) == commitment_i`. On success,
the secret is XOR-accumulated into a running `FinalSeed`:

```
FinalSeed = secret_1 XOR secret_2 XOR ... XOR secret_n
```

### Deriving a selection index

Given `FinalSeed` (32 bytes), derive a uniform index into a pool of size `N`:

```
index = u32::from_le_bytes(FinalSeed[0..4]) % N
```

For panel selection (pool = registered panel members list), iterate until
`panel_size` distinct members are chosen using successive 4-byte windows of the
seed (wrapping with a counter if needed):

```
for slot in 0..panel_size:
    idx = u32::from_le_bytes(FinalSeed[slot*4 % 32 .. (slot*4+4) % 32]) % pool_len
```

---

## 3. Security properties

| Property                           | Guarantee                                                                                                                                                                                                                              |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unpredictability before reveal** | No contributor knows the final seed before all reveals                                                                                                                                                                                 |
| **Bias resistance**                | An attacker controlling `k` out of `n` contributors can bias only their `k` contributions; the remaining `n-k` XOR shares cancel the bias probabilistically                                                                            |
| **Last-revealer advantage**        | The last contributor to reveal can observe the current running XOR and choose to withhold. Mitigation: require all panel members to commit before any reveals; slash any contributor who commits but does not reveal within the window |
| **Fallback**                       | If insufficient entropy contributors reveal, the admin multisig can set a manual seed override via `Disputes::set_fallback_seed` (v1 TODO — see ADR)                                                                                   |

---

## 4. Reporter assignment

Reporter assignment (README section 4.1, step 2) uses the same seed mechanism
seeded by the request creation ledger hash + a multi-party seed contributed by
the initial request creation transaction participants.

In v1 the assignment is **off-chain** (the worker selects eligible reporters from
the pool and submits their assignments), with the on-chain check being:

- Reporter must be Active in Registry
- Reporter's geohash cluster overlaps the request geohash (attested in Registry)
- Reporter has not already committed to this request

Full on-chain assignment using the commit-reveal seed is planned for Phase 3
(see roadmap).

---

## 5. Panel timeout default outcome

If the panel fails to rule within `ruling_window_secs` (default 7 days), anyone
can call `Disputes::resolve_timeout()`. The default outcome is:

```
timeout_outcome_upheld = false   // dispute is rejected
```

**Rationale:** The conservative default preserves the existing resolution rather
than voiding it on a non-decision. A frivolous challenger who bribes panel members
to abstain loses their bond at timeout (rejected outcome → bond slashed). This
makes abstention-as-attack expensive.

This can be changed per deployment via `Disputes::set_params`.

---

## 6. Implementation notes

- Seed storage uses `temporary` storage with a 15-day TTL — seeds must be
  committed and revealed before the TTL expires, or the data is lost.
- The XOR of all secrets is stored as `FinalSeed` in temporary storage.
- The `submit_seed_commitment` and `reveal_seed` functions both require the caller
  to be a registered panel member or the admin.
- The commitment is `sha256(secret || nonce)` — the nonce prevents preimage
  attacks on known-secret distributions.
