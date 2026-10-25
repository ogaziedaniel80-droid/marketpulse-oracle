# Data Specification: FUEL_PMS

- **Code:** `FUEL_PMS`
- **Category:** Energy & Fuel
- **Status:** Active (Launch Wave 1)
- **Target Countries:** Nigeria, Ghana

---

## 1. Unit & Grade

- **Unit:** 1 Litre (pump meter dispense).
- **Grade / Variety:** Premium Motor Spirit (PMS / Petrol), commercial automotive grade.
- **Value Structure:** Compound integer encoding:
  - High bits / status: `0 = Available / Dispensing`, `1 = Queuing (>30 min)`, `2 = Exhausted / Closed`.
  - Value: Pump price per litre in minor fiat units (e.g., 95,000 kobo = 950.00 NGN).

---

## 2. Location Granularity

- **Granularity:** Station or corridor-level geohash (7 to 8 characters).

---

## 3. Currency & Decimals

- **Currency:** Local fiat minor units (`NGN` kobo with 2 decimals; `GHS` pesewas with 2 decimals).

---

## 4. Consensus Tolerance Band

- **Default Tolerance:** 300 basis points (3.00%) for price; exact match for availability status.

---

## 5. Evidence Rule

- **Primary Evidence:** Photo of filling station digital or mechanical pump price meter and station totem board showing current pricing.
- **Secondary Evidence:** Printed POS pump receipt showing litre count, price/L, and station name.
