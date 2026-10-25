---
name: Data Type Proposal
about: Propose a new local data type for West Africa per README section 9
title: '[DATA TYPE] '
labels: data-type, proposal
assignees: ''
---

## Data Type Overview

- **Code (Symbol):** (e.g., `YAM_TUBER`, `PLANTAIN_BUNCH`)
- **Category:** (Staple food / Fuel / Infrastructure / Transport / Other)
- **Target Countries/Markets:** (e.g., Nigeria - Bodija Market Ibadan)

## Standardisation Specification (README 9.3)

1. **Unit:**
   *(e.g., 50 kg bag, standard derica measure, crate, liter)*
2. **Grade / Variety:**
   *(e.g., local parboiled vs imported, sweet white garri vs yellow garri)*
3. **Location Granularity:**
   *(Coarse market-level geohash: 6-8 chars. Never stall-level or personal residence)*
4. **Currency and Decimals:**
   *(Minor units, e.g., NGN with 2 decimals, XOF with 0 decimals)*
5. **Default Tolerance Band:**
   *(e.g., 800 bps = 8%)*
6. **Evidence Rule:**
   *(e.g., photo of stall with visible price tag, or timestamped market ticket)*

## Risk & Safety Assessment

- Does reporting this put the reporter at physical or regulatory risk?
- Is there potential for ambiguous grading or stall-to-stall variance exceeding 20%?
- Off-chain evidence verification feasibility.
