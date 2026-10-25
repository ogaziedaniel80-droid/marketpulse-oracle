# Security Policy and Responsible Disclosure

The MarketPulse Oracle team takes security vulnerabilities seriously. We appreciate the responsible disclosure of vulnerabilities by security researchers, auditors, and contributors.

---

## Reporting a Vulnerability

**DO NOT submit vulnerability reports through public GitHub issues, discussions, or pull requests.**

Instead, report vulnerabilities privately by emailing:
`security@marketpulse.org`

Include the following information in your report:

- Type of vulnerability (e.g., smart contract logic flaw, reentrancy, integer overflow, auth bypass, sybil attack bypass, relay griefing, unauthorized funds transfer).
- Affected contracts or packages (e.g. `contracts/request-board`, `contracts/registry`).
- Step-by-step reproduction instructions or a minimal proof-of-concept (PoC) test.
- Impact assessment and potential loss scenario.
- Suggested mitigations (if known).

---

## Vulnerability Handling SLA

- **Acknowledgment:** Within 48 hours of initial receipt.
- **Initial Assessment:** Within 5 business days, confirming validity and severity.
- **Remediation & Patching:** High and critical severity issues will be prioritized and resolved before public disclosure.
- **Public Disclosure:** Coordinated disclosure after patches are deployed and verified on testnet/mainnet.

---

## Bug Bounty Program

During testnet pilots and ahead of mainnet deployment, a bug bounty pool is established to reward security researchers who report valid vulnerabilities in scope.
Scope includes:

- Smart contracts: `contracts/registry`, `contracts/request-board`, `contracts/report-engine`, `contracts/disputes`, `contracts/oracle-feed`, and `contracts/shared`.
- Invariants defined in `README.md` Section 8.4 (e.g. escrow conservation, unauthorized state mutation, double commitment, manipulation of weighted median).
