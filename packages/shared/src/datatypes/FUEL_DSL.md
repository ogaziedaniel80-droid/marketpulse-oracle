# Data Specification: FUEL_DSL

- **Code:** `FUEL_DSL`
- **Category:** Energy & Fuel
- **Status:** Active (Launch Wave 1)
- **Target Countries:** Nigeria, Ghana

---

## 1. Unit & Grade

- **Unit:** 1 Litre (pump meter dispense).
- **Grade / Variety:** Automotive Gas Oil (AGO / Diesel), commercial 50ppm / standard sulfur grade.
- **Value Structure:** Compound integer encoding:
  - Availability status: `0 = Available`, `1 = Queuing`, `2 = Exhausted / Closed`.
  - Pump price per litre in minor fiat units (e.g., 120,000 kobo = 1,200.00 NGN).

---

## 2. Location Granularity

- **Granularity:** Station or industrial corridor geohash (7 to 8 characters).

---

## 3. Currency & Decimals

- **Currency:** Local fiat minor units (`NGN`, `GHS`).

---

## 4. Consensus Tolerance Band

- **Default Tolerance:** 300 basis points (3.00%) for price; exact match for availability status.

---

## 5. Evidence Rule

- **Primary Evidence:** Photo of diesel pump meter or station price board.
- **Secondary Evidence:** Printed POS pump receipt.
