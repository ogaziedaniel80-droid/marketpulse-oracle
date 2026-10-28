"""Unit tests for wallet clustering, timing correlation, and price agreement analytics."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import pytest

from src.graph_analysis import FundingGraphAnalyzer
from src.models import DatabaseFlag, SubmissionEvent, WalletTransfer
from src.pipeline import AnalyticsPipeline, generate_synthetic_collusion_data
from src.price_collusion import PriceCollusionDetector
from src.timing_correlation import TimingCorrelationDetector


class TestAnalyticsSuite:
    def test_funding_graph_single_funder_cluster(self):
        """Common origin address funding 3 reporter accounts is detected."""
        analyzer = FundingGraphAnalyzer(min_cluster_size=2)
        now = datetime.now(timezone.utc)
        funder = "GA_MASTER_FUNDER_111111111111111111111111111111111111111"
        rep1 = "GA_REP_A_22222222222222222222222222222222222222222222222"
        rep2 = "GA_REP_B_33333333333333333333333333333333333333333333333"

        transfers = [
            WalletTransfer(
                tx_hash="tx_1",
                from_address=funder,
                to_address=rep1,
                amount_stroops=10000000,
                timestamp=now,
            ),
            WalletTransfer(
                tx_hash="tx_2",
                from_address=funder,
                to_address=rep2,
                amount_stroops=10000000,
                timestamp=now,
            ),
        ]

        flags, clusters = analyzer.detect_funding_clusters(transfers, {rep1, rep2})
        assert len(clusters) == 1
        assert funder in clusters
        assert set(clusters[funder]) == {rep1, rep2}
        assert len(flags) == 2
        assert all(f.flag_type == "correlation_cluster" for f in flags)
        assert all(f.details["funder_address"] == funder for f in flags)

    def test_timing_correlation_bot_burst(self):
        """Bots submitting commits within 2 seconds across 2 requests are detected."""
        detector = TimingCorrelationDetector(
            delta_seconds_threshold=5.0, min_co_occurrences=2
        )
        now = datetime.now(timezone.utc)
        bot1 = "GA_BOT_1_111111111111111111111111111111111111111111111111"
        bot2 = "GA_BOT_2_222222222222222222222222222222222222222222222222"

        submissions = [
            # Request 1: 1 second apart
            SubmissionEvent(
                request_id=1,
                reporter_address=bot1,
                commit_timestamp=now,
            ),
            SubmissionEvent(
                request_id=1,
                reporter_address=bot2,
                commit_timestamp=now + timedelta(seconds=1.5),
            ),
            # Request 2: 2 seconds apart
            SubmissionEvent(
                request_id=2,
                reporter_address=bot1,
                commit_timestamp=now + timedelta(hours=1),
            ),
            SubmissionEvent(
                request_id=2,
                reporter_address=bot2,
                commit_timestamp=now + timedelta(hours=1, seconds=2.0),
            ),
        ]

        flags, clusters = detector.analyze_timing(submissions)
        assert len(clusters) == 1
        assert {bot1, bot2}.issubset(clusters[0])
        assert len(flags) == 2
        assert all(f.flag_type == "timing_suspicious" for f in flags)

    def test_price_collusion_identical_values(self):
        """Reporters coordinating to submit the exact same price across rounds are detected."""
        detector = PriceCollusionDetector(min_shared_requests=2)
        rep1 = "GA_CARTEL_1_1111111111111111111111111111111111111111111111"
        rep2 = "GA_CARTEL_2_2222222222222222222222222222222222222222222222"

        now = datetime.now(timezone.utc)
        submissions = [
            # Round 1: both submit 120,000 NGN
            SubmissionEvent(
                request_id=1,
                reporter_address=rep1,
                commit_timestamp=now,
                reported_value=120000,
            ),
            SubmissionEvent(
                request_id=1,
                reporter_address=rep2,
                commit_timestamp=now,
                reported_value=120000,
            ),
            # Round 2: both submit 125,000 NGN
            SubmissionEvent(
                request_id=2,
                reporter_address=rep1,
                commit_timestamp=now + timedelta(hours=2),
                reported_value=125000,
            ),
            SubmissionEvent(
                request_id=2,
                reporter_address=rep2,
                commit_timestamp=now + timedelta(hours=2),
                reported_value=125000,
            ),
        ]

        flags, clusters = detector.analyze_price_agreement(submissions)
        assert len(clusters) == 1
        assert {rep1, rep2}.issubset(clusters[0])
        assert len(flags) == 2
        assert all(f.flag_type == "correlation_cluster" for f in flags)

    def test_full_pipeline_on_synthetic_scenario(self):
        """Full pipeline run on synthetic dataset catches all sybils and preserves honest reporters."""
        transfers, submissions, reporters, ground_truth = (
            generate_synthetic_collusion_data()
        )
        pipeline = AnalyticsPipeline()

        flags = pipeline.run_all_jobs(transfers, submissions, reporters)
        assert len(flags) > 0

        flagged_addresses = {f.reporter_address for f in flags}
        sybils = {r for r, label in ground_truth.items() if label == "sybil"}
        honest = {r for r, label in ground_truth.items() if label == "honest"}

        # All 3 sybils must be detected
        assert sybils.issubset(flagged_addresses)
        # Zero false positives on honest reporters
        assert len(honest.intersection(flagged_addresses)) == 0

        # Validate database schema constraints on all generated flags
        valid_flag_types = {
            "evidence_duplicate",
            "geo_distance",
            "correlation_cluster",
            "timing_suspicious",
        }
        valid_severities = {"low", "medium", "high", "critical"}

        for flag in flags:
            assert flag.flag_type in valid_flag_types
            assert flag.severity in valid_severities
            assert isinstance(flag.details, dict)
            assert flag.reviewed is False
