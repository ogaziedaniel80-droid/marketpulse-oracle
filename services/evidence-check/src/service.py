"""Core evidence validation orchestrator."""
from __future__ import annotations

import io
from datetime import datetime
from typing import List, Optional
from PIL import Image

from .exif_parser import extract_exif, validate_exif
from .geofence import validate_geoplausibility
from .hasher import PerceptualHashStore, compute_dhash, compute_sha256
from .models import (
    CheckFlag,
    EvidenceCheckMetadata,
    EvidenceCheckResponse,
)
from .tampering import check_tampering_heuristics


class EvidenceCheckService:
    """Orchestrates all evidence integrity and anti-sybil checks.

    README Section 13:
    Off-chain checks (evidence, geo) are advisory and feed disputes;
    they do not unilaterally slash on-chain.
    """

    def __init__(self, hash_store: Optional[PerceptualHashStore] = None):
        self.hash_store = hash_store or PerceptualHashStore()

    def check_evidence(
        self,
        image_bytes: bytes,
        metadata: EvidenceCheckMetadata,
    ) -> EvidenceCheckResponse:
        """Run full check suite on submitted evidence photo."""
        # 1. Cryptographic SHA-256
        sha256 = compute_sha256(image_bytes)

        # 2. Open image with PIL
        try:
            image = Image.open(io.BytesIO(image_bytes))
            image.load()
        except Exception as e:
            critical_flag = CheckFlag(
                code="IMAGE_DECODE_FAILED",
                severity="critical",
                score_penalty=100.0,
                details=f"File could not be decoded as a valid image format: {str(e)}",
            )
            return EvidenceCheckResponse(
                valid=False,
                trust_score=0.0,
                evidence_sha256=sha256,
                perceptual_hash="0000000000000000",
                exif=None, # type: ignore
                flags=[critical_flag],
            )

        # 3. Perceptual Hash (dHash) & duplicate detection
        dhash = compute_dhash(image)
        duplicate_flags = self.hash_store.check_and_store(
            sha256=sha256,
            dhash=dhash,
            reporter_address=metadata.reporter_address,
            request_id=metadata.request_id,
            timestamp=metadata.claimed_timestamp,
        )

        # 4. EXIF extraction & validation
        exif_meta = extract_exif(image)
        exif_flags = validate_exif(exif_meta, metadata.claimed_timestamp)

        # 5. Geofence plausibility
        geo_flags = validate_geoplausibility(exif_meta, metadata.market_id)

        # 6. Tampering & synthetic heuristics
        tampering_flags = check_tampering_heuristics(image)

        # Aggregate all flags
        all_flags: List[CheckFlag] = [
            *duplicate_flags,
            *exif_flags,
            *geo_flags,
            *tampering_flags,
        ]

        # Calculate trust score (100 base, deductions for penalties)
        penalty_sum = sum(flag.score_penalty for flag in all_flags)
        trust_score = max(0.0, min(100.0, 100.0 - penalty_sum))

        # Check for critical disqualifications (e.g. blank screen or corrupt decode)
        has_critical = any(f.severity == "critical" for f in all_flags)
        valid = trust_score >= 40.0 and not (has_critical and trust_score < 30.0)

        return EvidenceCheckResponse(
            valid=valid,
            trust_score=round(trust_score, 1),
            evidence_sha256=sha256,
            perceptual_hash=dhash,
            exif=exif_meta,
            flags=all_flags,
        )
