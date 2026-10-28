"""Timing-correlation analytics to identify automated botnets and coordinated reporters."""
from __future__ import annotations

from collections import defaultdict
from itertools import combinations
from typing import Dict, List, Set, Tuple
import networkx as nx
import pandas as pd

from .models import DatabaseFlag, SubmissionEvent


class TimingCorrelationDetector:
    """Detects reporter wallets that submit commits within suspicious synchrony.

    README Section 11: Anti-sybil design - timing correlation detection.
    """

    def __init__(
        self,
        delta_seconds_threshold: float = 5.0,
        min_co_occurrences: int = 2,
    ):
        self.delta_seconds_threshold = delta_seconds_threshold
        self.min_co_occurrences = min_co_occurrences

    def analyze_timing(
        self,
        submissions: List[SubmissionEvent],
    ) -> Tuple[List[DatabaseFlag], List[Set[str]]]:
        if not submissions:
            return [], []

        # Convert to pandas DataFrame for efficient grouping
        df = pd.DataFrame(
            [
                {
                    "request_id": s.request_id,
                    "reporter_address": s.reporter_address,
                    "commit_time": s.commit_timestamp,
                }
                for s in submissions
            ]
        )

        pair_co_occurrences = defaultdict(int)
        pair_requests = defaultdict(list)

        # Group by request_id
        for req_id, group in df.groupby("request_id"):
            reps = group.sort_values("commit_time").to_dict("records")
            n = len(reps)

            for i in range(n):
                for j in range(i + 1, n):
                    r1 = reps[i]
                    r2 = reps[j]
                    delta = abs((r2["commit_time"] - r1["commit_time"]).total_seconds())

                    if delta <= self.delta_seconds_threshold:
                        rep1 = r1["reporter_address"]
                        rep2 = r2["reporter_address"]
                        pair = tuple(sorted([rep1, rep2]))
                        pair_co_occurrences[pair] += 1
                        pair_requests[pair].append(req_id)

        # Construct correlation graph
        G = nx.Graph()
        for (rep1, rep2), count in pair_co_occurrences.items():
            if count >= self.min_co_occurrences:
                G.add_edge(rep1, rep2, weight=count, requests=pair_requests[(rep1, rep2)])

        flags: List[DatabaseFlag] = []
        clusters: List[Set[str]] = []

        # Connected components of synchronized sub-graphs
        for comp in nx.connected_components(G):
            if len(comp) >= 2:
                clusters.append(comp)
                severity = "critical" if len(comp) >= 4 else "high"

                for rep in comp:
                    peers = [p for p in comp if p != rep]
                    # Collect requests where this reporter showed timing synchrony
                    relevant_requests = set()
                    for p in peers:
                        pair = tuple(sorted([rep, p]))
                        relevant_requests.update(pair_requests.get(pair, []))

                    flags.append(
                        DatabaseFlag(
                            flag_type="timing_suspicious",
                            reporter_address=rep,
                            severity=severity,
                            details={
                                "detection_mechanism": "commit_timing_synchrony",
                                "cluster_size": len(comp),
                                "peer_reporters": peers,
                                "synchronized_requests_count": len(relevant_requests),
                                "max_time_delta_seconds": self.delta_seconds_threshold,
                                "explanation": (
                                    f"Commit timestamps consistently submitted within {self.delta_seconds_threshold}s "
                                    f"of {len(peers)} other wallet(s) across {len(relevant_requests)} requests."
                                ),
                            },
                        )
                    )

        return flags, clusters
