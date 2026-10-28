"""Funding-source graph analysis using NetworkX to identify Sybil clusters."""
from __future__ import annotations

from typing import Dict, List, Set, Tuple
import networkx as nx
import pandas as pd

from .models import DatabaseFlag, WalletTransfer


class FundingGraphAnalyzer:
    """Detects Sybil clusters originating from shared funding sources.

    README Section 11: Correlation detection for wallets sharing funding sources.
    """

    def __init__(self, min_cluster_size: int = 2):
        self.min_cluster_size = min_cluster_size

    def build_graph(self, transfers: List[WalletTransfer]) -> nx.DiGraph:
        G = nx.DiGraph()
        for t in transfers:
            G.add_edge(
                t.from_address,
                t.to_address,
                tx_hash=t.tx_hash,
                amount=t.amount_stroops,
                timestamp=t.timestamp,
            )
        return G

    def detect_funding_clusters(
        self,
        transfers: List[WalletTransfer],
        reporter_addresses: Set[str],
    ) -> Tuple[List[DatabaseFlag], Dict[str, List[str]]]:
        """Identify reporter wallets funded by the same origin address."""
        G = self.build_graph(transfers)
        flags: List[DatabaseFlag] = []
        clusters_by_funder: Dict[str, List[str]] = {}

        # Scan all potential funder nodes (nodes with out_degree >= min_cluster_size)
        for node in G.nodes():
            funded_reporters = [
                succ for succ in G.successors(node) if succ in reporter_addresses
            ]

            if len(funded_reporters) >= self.min_cluster_size:
                clusters_by_funder[node] = funded_reporters
                cluster_size = len(funded_reporters)
                severity = "critical" if cluster_size >= 4 else ("high" if cluster_size >= 3 else "medium")

                for rep in funded_reporters:
                    peers = [p for p in funded_reporters if p != rep]
                    flags.append(
                        DatabaseFlag(
                            flag_type="correlation_cluster",
                            reporter_address=rep,
                            severity=severity,
                            details={
                                "detection_mechanism": "common_funder_graph",
                                "funder_address": node,
                                "cluster_size": cluster_size,
                                "peer_reporters": peers,
                                "explanation": (
                                    f"Wallet funded by common origin {node[:8]}... "
                                    f"along with {len(peers)} other active reporter wallet(s)."
                                ),
                            },
                        )
                    )

        return flags, clusters_by_funder
