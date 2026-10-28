"""Perceptual hashing and duplicate image detection across reporters and time."""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple
from PIL import Image

from .models import CheckFlag


def compute_sha256(data: bytes) -> str:
    """Compute standard SHA-256 hex digest."""
    return hashlib.sha256(data).hexdigest()


def compute_dhash(image: Image.Image, hash_size: int = 8) -> str:
    """Compute difference hash (dHash) for perceptual image comparison.

    1. Convert to grayscale.
    2. Resize to (hash_size + 1, hash_size) -> (9, 8).
    3. Compare adjacent horizontal pixels (pixel[col] > pixel[col+1]).
    4. Pack into 64-bit integer formatted as 16-character hex.
    """
    gray = image.convert("L").resize((hash_size + 1, hash_size), Image.Resampling.LANCZOS)
    pixels = list(gray.getdata())

    diff_bits = 0
    for row in range(hash_size):
        row_offset = row * (hash_size + 1)
        for col in range(hash_size):
            left = pixels[row_offset + col]
            right = pixels[row_offset + col + 1]
            diff_bits = (diff_bits << 1) | (1 if left > right else 0)

    return f"{diff_bits:016x}"


def hamming_distance(hash1_hex: str, hash2_hex: str) -> int:
    """Compute bitwise Hamming distance between two 64-bit hex hashes."""
    val1 = int(hash1_hex, 16)
    val2 = int(hash2_hex, 16)
    return bin(val1 ^ val2).count("1")


@dataclass
class StoredHashEntry:
    sha256: str
    dhash: str
    reporter_address: str
    request_id: str
    timestamp: datetime


class PerceptualHashStore:
    """Tracks submitted image hashes to detect cross-reporter collusion and temporal recycling.

    README Section 11: Photo reuse or stock images detected via pHash duplicate detection.
    """

    def __init__(self, similarity_threshold: int = 5):
        # Hamming distance <= 5 out of 64 bits indicates highly identical/perceptually same image
        self.similarity_threshold = similarity_threshold
        self._entries: List[StoredHashEntry] = []

    def check_and_store(
        self,
        sha256: str,
        dhash: str,
        reporter_address: str,
        request_id: str,
        timestamp: Optional[datetime] = None,
    ) -> List[CheckFlag]:
        ts = timestamp or datetime.now(timezone.utc)
        flags: List[CheckFlag] = []

        for entry in self._entries:
            dist = hamming_distance(dhash, entry.dhash)
            exact_sha = sha256 == entry.sha256

            if dist <= self.similarity_threshold or exact_sha:
                if entry.reporter_address != reporter_address:
                    flags.append(
                        CheckFlag(
                            code="IMAGE_DUPLICATE_CROSS_REPORTER",
                            severity="critical" if dist <= 2 else "high",
                            score_penalty=40.0 if dist <= 2 else 25.0,
                            details=(
                                f"Perceptually identical image (Hamming distance {dist}/64) "
                                f"previously submitted by reporter {entry.reporter_address[:8]}... "
                                f"in request {entry.request_id}."
                            ),
                        )
                    )
                else:
                    if entry.request_id != request_id:
                        flags.append(
                            CheckFlag(
                                code="IMAGE_DUPLICATE_TEMPORAL",
                                severity="high" if dist <= 2 else "medium",
                                score_penalty=30.0 if dist <= 2 else 15.0,
                                details=(
                                    f"Photo reuse across requests (Hamming distance {dist}/64). "
                                    f"Same reporter previously used this image for request {entry.request_id}."
                                ),
                            )
                        )

        # Store for future comparisons
        self._entries.append(
            StoredHashEntry(
                sha256=sha256,
                dhash=dhash,
                reporter_address=reporter_address,
                request_id=request_id,
                timestamp=ts,
            )
        )
        return flags

    def clear(self) -> None:
        self._entries.clear()
