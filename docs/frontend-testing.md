# Frontend Testing, Accessibility & Low-Bandwidth Performance Guide

**Companion Specification:** `README.md` Section 12 (Reporter experience and onboarding) & Section 17 (Testing strategy).

---

## 1. Low-Bandwidth Performance Budget

West African field reporters frequently operate on intermittent 3G/Edge networks using mid-range Android devices (e.g., Tecno Spark 10, Infinix Smart 8, Samsung Galaxy A14) with 2–4 GB RAM.

| Metric                               | Budget Limit                    | Enforcement                                                                             |
| ------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------- |
| **Reporter Initial JS Payload**      | `<= 120 KB` (compressed)        | Enforced in `apps/web/src/currency.ts` (`PERFORMANCE_BUDGET.maxReporterInitialJsBytes`) |
| **Client-Compressed Evidence Photo** | `<= 150 KB` per upload          | Enforced in `compressAndHashPhoto()` prior to SHA-256 hashing and upload                |
| **Time to Interactive (Slow 3G)**    | `<= 3,500 ms`                   | App shell cached by Service Worker (`apps/web/public/sw.js`)                            |
| **Heavy Buyer Dependencies**         | Lazy-loaded only on Buyer route | MapLibre GL and Recharts are isolated from the Reporter bundle                          |

---

## 2. Accessibility Basics (WCAG 2.1 AA)

1. **Touch Targets:** Every interactive button and input in the Reporter PWA enforces a minimum height of `48px` (`min-height: 48px`) so reporters in bustling outdoor markets can tap accurately with one hand.
2. **High Contrast Outdoors:** Default palette uses `#f8fafc` foreground text on `#0f172a` / `#1e293b` backgrounds (> 13:1 contrast ratio) and high-visibility amber (`#fef3c7` on `#451a03`) for the mandatory **Stake at Risk** disclosure box.
3. **Screen Reader & Live Regions:**
   - Network connectivity banners (`#offline-banner`) and submission queue states (`#reporter-action-state`, `#buyer-request-status`) use `role="status"` and `aria-live="polite"`.
   - Every form control has an explicit `<label for="...">` association.
4. **Plain-Language Financial Warnings:**
   - Before every commit, the exact stake at risk is displayed in both local currency (`₦16,000 NGN`) and `USDC` (`~10.00 USDC`), alongside plain-language explanations of the 25% outlier slash and 80% non-reveal slash.

---

## 3. Mid-Range Android Field Testing Protocol

Before any pilot release, run the following verification checklist on a physical mid-range Android device (or Chrome DevTools with **CPU: 4x slowdown** and **Network: Slow 3G / Offline**):

1. **Installable PWA & Service Worker:**
   - Load the PWA over HTTPS (or `localhost:3000` via `adb reverse tcp:3000 tcp:3000`).
   - Confirm `manifest.json` registers and "Add to Home Screen" installs the standalone icon.
2. **Passkey Biometric Creation:**
   - Trigger passkey creation (`createPasskeyWallet`). Verify Android biometric prompt (fingerprint or device PIN) unlocks the secp256r1 credential without asking for a seed phrase or XLM balance.
3. **Offline-Then-Online Queue Resilience:**
   - Enable Airplane Mode while viewing an open `RICE50` request.
   - Acknowledge the **Stake at Risk** warning and tap **Lock Stake & Submit Encrypted Commit**.
   - Verify the UI immediately transitions to `QUEUED_OFFLINE` and blocks any duplicate commit tap (`DuplicateSubmissionPrevented`).
   - Disable Airplane Mode; verify the queue flushes automatically and transitions to `SYNCED` (or `EXPIRED_DEADLINE` if the commit window closed while offline).

---

## 4. Running Frontend Tests Locally

```bash
# 1. Build TypeScript & verify types
pnpm --filter web build

# 2. Run Vitest unit & integration suite (i18n, wallet, offline queue, compression, buyer Zod validation)
pnpm --filter web test

# 3. Run Playwright Chromium E2E smoke tests (Reporter happy path, Offline->Online queue, Buyer request creation)
pnpm --filter web test:e2e
```
