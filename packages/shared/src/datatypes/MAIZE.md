# Data Specification: MAIZE

- **Code:** `MAIZE`
- **Category:** Food Staples
- **Status:** Active (Launch Wave 1)
- **Target Countries:** Northern Nigeria, Ghana, Burkina Faso

---

## 1. Unit & Grade

- **Unit:** Standard 100 kg grain bag (or 50 kg bag equivalent).
- **Grade / Variety:** Clean dry yellow or white maize grain (food and feed grade).
- **Condition:** Moisture content <= 13%, free of weevil infestation and stones.

---

## 2. Location Granularity

- **Granularity:** Coarse market-level geohash (6 to 8 characters).
- **Pilot Markets:**
  - Dawanau Market, Kano
  - Giwa Market, Kaduna
  - Bodija Market, Ibadan
  - Techiman Market, Ghana

---

## 3. Currency & Decimals

- **Currency:** Local fiat minor units (`NGN`, `GHS`, `XOF`).
- **Decimals:** Fixed-point integer (2 decimals for NGN/GHS, 0 for XOF).

---

## 4. Consensus Tolerance Band

- **Default Tolerance:** 800 basis points (8.00%).

---

## 5. Evidence Rule

- **Primary Evidence:** Photo of bagged maize lot in market warehouse or stall with merchant tag or scale ticket.
- **Secondary Evidence:** Grain weighing scale reading or receipt.
