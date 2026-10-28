"""Price agreement and value collusion analytics."""
from __future__ import annotations

from collections import defaultdict
from typing import Dict, List, Set, Tuple
import networkx as nx
import pandas as pd

from .models import DatabaseFlag, SubmissionEvent


class PriceCollusionDetector:
    """Detects reporter rings that consistently report identical or coordinated prices.

    README Section 11: Anti-collusion design - wallets that always agree.
    """

    def __init__(self, min_shared_requests: int = 2):
        self.min_shared_requests = min_shared_requests

    def analyze_price_agreement(
        self,
        submissions: List[SubmissionEvent],
    ) -> Tuple[List[DatabaseFlag], List[Set[str]]]:
        valid_submissions = [s for s in submissions if s.reported_value is not None]
        if not valid_submissions:
            return [], []

        df = pd.DataFrame(
            [
                {
                    "request_id": s.request_id,
                    "reporter_address": s.reporter_address,
                    "value": s.reported_value,
                }
                for s in valid_submissions
            ]
        )

        pair_exact_matches = defaultdict(int)

        # For each request, identify reporters with identical submitted price
        for req_id, group in df.groupby("request_id"):
            val_groups = group.groupby("value")
            for val, vgroup in val_groups:
                if len(vgroup) >= 2:
                    reps = vgroup["reporter_address"].tolist()
                    n = len(reps)
                    for i in range(n):
                        for j in range(i + 1, n):
                            pair = tuple(sorted([reps[i], reps[j]]))
                            pair_exact_matches[pair] += 1

        G = nx.Graph()
        for (rep1, rep2), count in pair_exact_matches.items():
            if count >= self.min_shared_requests:
                G.add_edge(rep1, rep2, weight=count)

        flags: List[DatabaseFlag] = []
        clusters: List[Set[str]] = []

        for comp in nx.connected_components(G):
            if len(comp) >= 2:
                clusters.append(comp)
                for rep in comp:
                    peers = [p for p in comp if p != rep]
                    flags.append(
                        DatabaseFlag(
                            flag_type="correlation_cluster",
                            reporter_address=rep,
                            severity="high" if len(comp) >= 3 else "medium",
                            details={
                                "detection_mechanism": "identical_reported_values",
                                "cluster_size": len(comp),
                                "peer_reporters": peers,
                                "explanation": (
                                    f"Reported identical prices with {len(peers)} other wallet(s) "
                                    f"across {self.min_shared_requests}+ oracle requests."
                                ),
                            },
                        )
                    )

        return flags, clusters
