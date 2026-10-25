# Data Specification: TOMATO

- **Code:** `TOMATO`
- **Category:** Perishable Produce
- **Status:** Active (Launch Wave 1)
- **Target Countries:** Nigeria (Lagos, Kano, Ibadan, Abuja)

---

## 1. Unit & Grade

- **Unit:** Standard raffia basket or wooden crate (standardized ~40-50 kg wholesale crate).
- **Grade / Variety:** Fresh ripe plum tomatoes (Roma / UTC variety, firm, culinary red).
- **Condition:** Freshly arrived harvest, minimal spoilage / crushing (<5%).

---

## 2. Location Granularity

- **Granularity:** Coarse market-level geohash (6 to 8 characters).
- **Pilot Markets:**
  - Mile 12 Market, Lagos
  - Utako Market, Abuja
  - Bodija Market, Ibadan
  - Yan Kaba Market, Kano

---

## 3. Currency & Decimals

- **Currency:** Local fiat minor units (`NGN` kobo with 2 decimals).
- **Decimals:** 2 decimals fixed-point integer.

---

## 4. Consensus Tolerance Band

- **Default Tolerance:** 1200 basis points (12.00%).
- **Rationale:** Fresh produce experiences wider intraday volatility and perishable quality grades compared to dry grains.

---

## 5. Evidence Rule

- **Primary Evidence:** Photo of basket/crate lot with freshness clearly visible and stall number/price chalk marker.
- **Secondary Evidence:** Market loading slip or handwritten sales invoice.
