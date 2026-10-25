# Data Specification: RICE50

- **Code:** `RICE50`
- **Category:** Food Staples
- **Status:** Active (Launch Wave 1)
- **Target Countries:** Nigeria, Ghana, Senegal, Côte d'Ivoire

---

## 1. Unit & Grade

- **Unit:** 50 kg bag (standard commercial wholesale/retail bag).
- **Grade / Variety:** Local standard parboiled milled rice (e.g. Mama Gold/Royal Stallion standard equivalent, or premium local parboiled like Abakaliki/Faro).
- **Condition:** Sealed/clean dry bag, no mold, pests, or excessive broken grains (>15%).

---

## 2. Location Granularity

- **Granularity:** Market-level coarse geohash (6 to 8 characters, covering ~150 m to ~1.2 km).
- **Pilot Markets:**
  - Wuse Market, Abuja (`s14b3k9x`)
  - Garki Modern Market, Abuja
  - Mile 12 International Market, Lagos
  - Bodija Market, Ibadan
  - Dawanau International Grains Market, Kano

---

## 3. Currency & Decimals

- **Currency:** Local fiat minor units (e.g., `NGN` kobo with 2 decimals; `GHS` pesewas with 2 decimals; `XOF` centimes with 0 decimals).
- **Default Display:** 2 decimal places fixed-point integer (e.g. 85,000 NGN represented as `8500000`).

---

## 4. Consensus Tolerance Band

- **Default Tolerance:** 800 basis points (8.00%).
- **Rationale:** Captures normal stall-to-stall variance, minor bargaining margins, and intra-day price fluctuations in informal grain markets without triggering outlier penalties for honest reporters.

---

## 5. Evidence Rule

- **Primary Evidence:** Time-stamped photo of the 50 kg rice bag display at the merchant stall, showing the merchant's price tag or chalk board where available.
- **Secondary Evidence:** Scanned physical receipt or handwritten merchant order invoice showing weight and total price paid.
- **Off-chain Storage:** Evidence uploaded to decentralized storage / S3 bucket; SHA-256 hash submitted on-chain.
