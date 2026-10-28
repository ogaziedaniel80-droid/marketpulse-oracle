"""Analytics pipeline orchestrator for collusion and correlation detection."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Dict, List, Optional, Set, Tuple
import pandas as pd

from .graph_analysis import FundingGraphAnalyzer
from .models import DatabaseFlag, SubmissionEvent, WalletTransfer
from .price_collusion import PriceCollusionDetector
from .timing_correlation import TimingCorrelationDetector


class AnalyticsPipeline:
    def __init__(
        self,
        funding_analyzer: Optional[FundingGraphAnalyzer] = None,
        timing_detector: Optional[TimingCorrelationDetector] = None,
        price_detector: Optional[PriceCollusionDetector] = None,
    ):
        self.funding_analyzer = funding_analyzer or FundingGraphAnalyzer()
        self.timing_detector = timing_detector or TimingCorrelationDetector()
        self.price_detector = price_detector or PriceCollusionDetector()

    def run_all_jobs(
        self,
        transfers: List[WalletTransfer],
        submissions: List[SubmissionEvent],
        reporter_addresses: Set[str],
    ) -> List[DatabaseFlag]:
        """Run all analytics jobs and aggregate output flags."""
        all_flags: List[DatabaseFlag] = []

        # 1. Funding Graph Analysis
        funding_flags, _ = self.funding_analyzer.detect_funding_clusters(
            transfers, reporter_addresses
        )
        all_flags.extend(funding_flags)

        # 2. Timing Correlation Analysis
        timing_flags, _ = self.timing_detector.analyze_timing(submissions)
        all_flags.extend(timing_flags)

        # 3. Price Collusion Agreement Analysis
        price_flags, _ = self.price_detector.analyze_price_agreement(submissions)
        all_flags.extend(price_flags)

        return all_flags


def generate_synthetic_collusion_data() -> Tuple[
    List[WalletTransfer], List[SubmissionEvent], Set[str], Dict[str, str]
]:
    """Generate deterministic synthetic data containing honest reporters and a colluding Sybil cartel.

    README §11 attack scenario: Sybil swarm to control the median.
    """
    now = datetime.now(timezone.utc)

    # 4 honest reporters
    honest_reporters = [
        "GA_HONEST_ALHAJI_MUSA_1111111111111111111111111111111111",
        "GA_HONEST_CHIOMA_OKEKE_22222222222222222222222222222222",
        "GA_HONEST_IBRAHIM_H_3333333333333333333333333333333333",
        "GA_HONEST_BLESSING_E_4444444444444444444444444444444444",
    ]

    # 3 Sybils funded by a single Sybil master wallet
    sybil_master = "GA_SYBIL_MASTER_OPERATOR_999999999999999999999999999999"
    sybil_reporters = [
        "GA_SYBIL_BOT_1_AAAA111111111111111111111111111111111111",
        "GA_SYBIL_BOT_2_BBBB222222222222222222222222222222222222",
        "GA_SYBIL_BOT_3_CCCC333333333333333333333333333333333333",
    ]

    all_reporters = set(honest_reporters + sybil_reporters)
    ground_truth = {
        r: ("honest" if r in honest_reporters else "sybil") for r in all_reporters
    }

    # 1. Funding transfers:
    # Honest reporters funded from diverse individual on-ramps/anchors
    transfers: List[WalletTransfer] = []
    for i, rep in enumerate(honest_reporters):
        transfers.append(
            WalletTransfer(
                tx_hash=f"tx_honest_fund_{i}",
                from_address=f"GA_ANCHOR_GATEWAY_{i}_8888888888888888888888888888888",
                to_address=rep,
                amount_stroops=50000000,  # 5 XLM
                timestamp=now - timedelta(days=10 + i),
            )
        )

    # Sybil reporters all funded by the single master operator
    for i, rep in enumerate(sybil_reporters):
        transfers.append(
            WalletTransfer(
                tx_hash=f"tx_sybil_fund_{i}",
                from_address=sybil_master,
                to_address=rep,
                amount_stroops=50000000,
                timestamp=now - timedelta(days=2),
            )
        )

    # 2. Submissions across 3 oracle requests:
    submissions: List[SubmissionEvent] = []
    requests = [101, 102, 103]
    honest_base_prices = [82000, 83500, 81000]

    for req_idx, req_id in enumerate(requests):
        req_time = now - timedelta(hours=24 * (3 - req_idx))
        base_p = honest_base_prices[req_idx]

        # Honest reporters submit independently with natural time spreads and realistic price noise
        for rep_idx, rep in enumerate(honest_reporters):
            time_offset = timedelta(minutes=15 * rep_idx + (rep_idx * 7) % 19)
            price_offset = (rep_idx - 1) * 500
            submissions.append(
                SubmissionEvent(
                    request_id=req_id,
                    reporter_address=rep,
                    commit_timestamp=req_time + time_offset,
                    reveal_timestamp=req_time + time_offset + timedelta(hours=1),
                    reported_value=base_p + price_offset,
                )
            )

        # Sybils submit near-simultaneously (1 second apart) with identical inflated collusive prices
        sybil_collusion_price = 145000  # Attempting to manipulate rice price upward
        sybil_burst_time = req_time + timedelta(minutes=45)
        for rep_idx, rep in enumerate(sybil_reporters):
            submissions.append(
                SubmissionEvent(
                    request_id=req_id,
                    reporter_address=rep,
                    commit_timestamp=sybil_burst_time + timedelta(seconds=rep_idx * 1.2),
                    reveal_timestamp=sybil_burst_time + timedelta(hours=1, seconds=rep_idx),
                    reported_value=sybil_collusion_price,
                )
            )

    return transfers, submissions, all_reporters, ground_truth
