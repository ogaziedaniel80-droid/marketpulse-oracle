# Data Specification: POWER (Planned - Disabled by Default)

- **Code:** `POWER`
- **Category:** Utilities & Infrastructure
- **Status:** Planned (Wave 2) - Disabled by default
- **Safety Assessment:** Low risk; reporter privacy must be safeguarded (no residential feeder identification without anonymization).

---

## 1. Description

Grid outage status at a feeder or neighborhood cluster (On, Off, Intermittent) with cumulative outage duration in hours.

## 2. Planned Unit & Values

- Status Enum: `0 = Power Present / Live`, `1 = Outage`, `2 = Low Voltage / Brownout`.
- Outage Duration: Minutes of consecutive outage.
