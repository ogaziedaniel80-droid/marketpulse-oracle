use crate::errors::ContractError;

pub const BPS_DENOMINATOR: i128 = 10_000;

/// Multiplies an amount by basis points (1 bps = 0.01%).
/// 10_000 bps = 100.00%.
pub fn bps_mul(amount: i128, bps: u32) -> Result<i128, ContractError> {
    let bps_i128 = bps as i128;
    amount
        .checked_mul(bps_i128)
        .ok_or(ContractError::MathOverflow)?
        .checked_div(BPS_DENOMINATOR)
        .ok_or(ContractError::MathDivisionByZero)
}

/// Divides an amount by basis points.
pub fn bps_div(amount: i128, bps: u32) -> Result<i128, ContractError> {
    if bps == 0 {
        return Err(ContractError::MathDivisionByZero);
    }
    let bps_i128 = bps as i128;
    amount
        .checked_mul(BPS_DENOMINATOR)
        .ok_or(ContractError::MathOverflow)?
        .checked_div(bps_i128)
        .ok_or(ContractError::MathDivisionByZero)
}

/// Computes the absolute difference in basis points relative to a base value:
/// |a - b| * 10_000 / base
pub fn bps_diff(a: i128, b: i128, base: i128) -> Result<u32, ContractError> {
    if base <= 0 {
        return Err(ContractError::MathDivisionByZero);
    }
    let diff = (a - b).checked_abs().ok_or(ContractError::MathOverflow)?;
    let scaled = diff
        .checked_mul(BPS_DENOMINATOR)
        .ok_or(ContractError::MathOverflow)?;
    let bps = scaled
        .checked_div(base)
        .ok_or(ContractError::MathDivisionByZero)?;
    if bps > u32::MAX as i128 {
        return Err(ContractError::MathOverflow);
    }
    Ok(bps as u32)
}

/// Checks whether `value` is within `tolerance_bps` of `target`.
/// Condition: |value - target| * 10_000 <= target * tolerance_bps
pub fn tolerance_check_bps(
    value: i128,
    target: i128,
    tolerance_bps: u32,
) -> Result<bool, ContractError> {
    if target == 0 {
        return Ok(value == 0);
    }
    if target < 0 {
        return Err(ContractError::InvalidParameter);
    }
    let diff = (value - target)
        .checked_abs()
        .ok_or(ContractError::MathOverflow)?;
    let scaled_diff = diff
        .checked_mul(BPS_DENOMINATOR)
        .ok_or(ContractError::MathOverflow)?;
    let max_allowed_diff = target
        .checked_mul(tolerance_bps as i128)
        .ok_or(ContractError::MathOverflow)?;

    Ok(scaled_diff <= max_allowed_diff)
}

/// Converts human units to minor units given `decimals`.
pub fn to_minor_units(units: i128, decimals: u32) -> Result<i128, ContractError> {
    let factor = 10_i128
        .checked_pow(decimals)
        .ok_or(ContractError::MathOverflow)?;
    units.checked_mul(factor).ok_or(ContractError::MathOverflow)
}

/// Converts minor units to whole units given `decimals`.
pub fn from_minor_units(minor: i128, decimals: u32) -> Result<i128, ContractError> {
    let factor = 10_i128
        .checked_pow(decimals)
        .ok_or(ContractError::MathOverflow)?;
    minor
        .checked_div(factor)
        .ok_or(ContractError::MathDivisionByZero)
}

/// Computes the reputation-weighted median of `(value, weight)` pairs.
///
/// Deterministic Tie-Break Rule:
/// 1. Elements are sorted by `value` in ascending order.
/// 2. Let total weight be W = sum(w_i).
/// 3. We iterate through the sorted list, accumulating weight C_k = sum_{i=0}^k w_i.
/// 4. If C_k * 2 == W (total weight is even and cumulative weight reaches exactly 50%),
///    the median falls exactly between value_k and value_{k+1}.
///    The tie is broken by taking the deterministic integer mean:
///    `(value_k + value_{k+1}) / 2`.
/// 5. Otherwise, the median is value_k for the first element where C_k * 2 > W.
///
/// Handled error cases:
/// - Empty input -> `Err(ContractError::EmptyReports)`
/// - Input length > 32 -> `Err(ContractError::MaxReportsExceedsCap)`
/// - Zero or invalid weight -> `Err(ContractError::InvalidParameter)`
pub fn weighted_median(items: &[(i128, u32)]) -> Result<i128, ContractError> {
    let n = items.len();
    if n == 0 {
        return Err(ContractError::EmptyReports);
    }
    if n > 32 {
        return Err(ContractError::MaxReportsExceedsCap);
    }

    if n == 1 {
        if items[0].1 == 0 {
            return Err(ContractError::InvalidParameter);
        }
        return Ok(items[0].0);
    }

    // Stack-allocated array for bounded max_reports (max 32), avoiding dynamic heap allocation.
    let mut sorted: [(i128, u32); 32] = [(0, 0); 32];
    let mut total_weight: u64 = 0;

    for i in 0..n {
        let (val, weight) = items[i];
        if weight == 0 {
            return Err(ContractError::InvalidParameter);
        }
        total_weight = total_weight
            .checked_add(weight as u64)
            .ok_or(ContractError::MathOverflow)?;
        sorted[i] = (val, weight);
    }

    // In-place insertion sort (optimal for n <= 32 and CPU instruction budgets)
    for i in 1..n {
        let key = sorted[i];
        let mut j = i;
        while j > 0 && sorted[j - 1].0 > key.0 {
            sorted[j] = sorted[j - 1];
            j -= 1;
        }
        sorted[j] = key;
    }

    // Accumulate weight to locate median
    let mut cum_weight: u64 = 0;
    for i in 0..n {
        cum_weight = cum_weight
            .checked_add(sorted[i].1 as u64)
            .ok_or(ContractError::MathOverflow)?;

        // Check for exact 50% tie
        if cum_weight.checked_mul(2) == Some(total_weight) {
            let next_val = sorted[i + 1].0;
            let current_val = sorted[i].0;
            let sum = current_val
                .checked_add(next_val)
                .ok_or(ContractError::MathOverflow)?;
            return Ok(sum / 2);
        }

        // Standard majority crossing
        if cum_weight.checked_mul(2) > Some(total_weight) {
            return Ok(sorted[i].0);
        }
    }

    // Fallback (unreachable if total_weight > 0)
    Ok(sorted[n - 1].0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_bps_mul_and_div() {
        // 100 USDC (1_000_000_000) * 8% (800 bps) = 8 USDC (80_000_000)
        let amount = 1_000_000_000i128;
        assert_eq!(bps_mul(amount, 800).unwrap(), 80_000_000);

        // 100% of amount
        assert_eq!(bps_mul(amount, 10_000).unwrap(), amount);

        // 0% of amount
        assert_eq!(bps_mul(amount, 0).unwrap(), 0);

        // bps_div
        assert_eq!(bps_div(80_000_000, 800).unwrap(), amount);
        assert_eq!(
            bps_div(amount, 0).unwrap_err(),
            ContractError::MathDivisionByZero
        );
    }

    #[test]
    fn test_bps_diff() {
        let base = 100_000i128;
        assert_eq!(bps_diff(108_000, 100_000, base).unwrap(), 800);
        assert_eq!(bps_diff(92_000, 100_000, base).unwrap(), 800);
        assert_eq!(bps_diff(100_000, 100_000, base).unwrap(), 0);
    }

    #[test]
    fn test_tolerance_check_bps() {
        let target = 80_000i128;
        let tolerance = 800u32; // 8% = +- 6400 -> [73600, 86400]

        assert!(tolerance_check_bps(80_000, target, tolerance).unwrap());
        assert!(tolerance_check_bps(86_400, target, tolerance).unwrap());
        assert!(tolerance_check_bps(73_600, target, tolerance).unwrap());

        // Just outside
        assert!(!tolerance_check_bps(86_401, target, tolerance).unwrap());
        assert!(!tolerance_check_bps(73_599, target, tolerance).unwrap());

        // Zero target
        assert!(tolerance_check_bps(0, 0, tolerance).unwrap());
        assert!(!tolerance_check_bps(10, 0, tolerance).unwrap());
    }

    #[test]
    fn test_weighted_median_empty_input_handled_as_error() {
        let empty: &[(i128, u32)] = &[];
        assert_eq!(
            weighted_median(empty).unwrap_err(),
            ContractError::EmptyReports
        );
    }

    #[test]
    fn test_weighted_median_single_value() {
        assert_eq!(weighted_median(&[(42_000, 100)]).unwrap(), 42_000);
        assert_eq!(
            weighted_median(&[(42_000, 0)]).unwrap_err(),
            ContractError::InvalidParameter
        );
    }

    #[test]
    fn test_weighted_median_equal_weights_odd() {
        let reports = [(30, 10), (10, 10), (20, 10)];
        assert_eq!(weighted_median(&reports).unwrap(), 20);
    }

    #[test]
    fn test_weighted_median_equal_weights_even_tie_break() {
        // [10, 20] with equal weight 10 each -> total weight 20 -> cum 10 hits exactly 50%
        // Tie break: (10 + 20) / 2 = 15
        let reports = [(20, 10), (10, 10)];
        assert_eq!(weighted_median(&reports).unwrap(), 15);

        // [10, 20, 30, 40] with equal weight 1
        // Total weight 4. cum at 20 is 2 == 4/2.
        // Tie break between 20 and 30: (20 + 30) / 2 = 25
        let reports4 = [(40, 1), (10, 1), (30, 1), (20, 1)];
        assert_eq!(weighted_median(&reports4).unwrap(), 25);
    }

    #[test]
    fn test_weighted_median_unequal_weights() {
        // High reputation reporter pulls median
        let reports = [
            (100, 10),  // weight 10
            (200, 10),  // weight 10
            (500, 100), // weight 100 (dominant)
        ];
        // Total weight = 120. Half = 60.
        // 100 (cum 10)
        // 200 (cum 20)
        // 500 (cum 120 > 60) -> 500
        assert_eq!(weighted_median(&reports).unwrap(), 500);

        // Outlier with low weight doesn't shift median
        let reports2 = [
            (80_000, 10),
            (81_000, 10),
            (82_000, 10),
            (80_500, 10),
            (500_000, 1), // massive outlier with low weight
        ];
        // Sorted: 80000(10), 80500(10), 81000(10), 82000(10), 500000(1)
        // Total weight = 41. Half = 20.5
        // 80000 cum 10
        // 80500 cum 20
        // 81000 cum 30 > 20.5 -> 81000
        assert_eq!(weighted_median(&reports2).unwrap(), 81_000);
    }

    #[test]
    fn test_weighted_median_all_equal_values() {
        let reports = [(50, 10), (50, 20), (50, 5)];
        assert_eq!(weighted_median(&reports).unwrap(), 50);
    }
}
