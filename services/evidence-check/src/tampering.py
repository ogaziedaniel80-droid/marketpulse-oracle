"""Image tampering and anomaly heuristics."""
from __future__ import annotations

import math
from typing import List, Tuple
from PIL import Image

from .models import CheckFlag


def calculate_shannon_entropy(image: Image.Image) -> float:
    """Calculate the Shannon entropy of pixel intensities (0 to 8 bits).

    Natural market photographs have entropy typically > 4.5 bits.
    Synthetic solid blocks, blank screens, or simple artificial patterns have low entropy (< 2.5).
    """
    gray = image.convert("L")
    histogram = gray.histogram()
    total_pixels = sum(histogram)
    if total_pixels == 0:
        return 0.0

    entropy = 0.0
    for count in histogram:
        if count > 0:
            p = count / total_pixels
            entropy -= p * math.log2(p)

    return entropy


def check_tampering_heuristics(image: Image.Image) -> List[CheckFlag]:
    """Run basic tampering and synthetic image heuristics."""
    flags: List[CheckFlag] = []
    width, height = image.size

    # 1. Minimum resolution check (README: assume mid-range mobile cameras, at least 320x320)
    if width < 320 or height < 320:
        flags.append(
            CheckFlag(
                code="IMAGE_RESOLUTION_TOO_LOW",
                severity="medium",
                score_penalty=15.0,
                details=f"Image resolution {width}x{height} is below minimum 320x320 requirement for price evidence.",
            )
        )

    # 2. Extreme aspect ratio
    aspect = max(width / max(1, height), height / max(1, width))
    if aspect > 8.0:
        flags.append(
            CheckFlag(
                code="IMAGE_ANOMALOUS_ASPECT_RATIO",
                severity="medium",
                score_penalty=15.0,
                details=f"Anomalous aspect ratio {width}x{height} (ratio {aspect:.1f}:1).",
            )
        )

    # 3. Shannon entropy (blank / solid screen detection)
    entropy = calculate_shannon_entropy(image)
    if entropy < 2.0:
        flags.append(
            CheckFlag(
                code="IMAGE_LOW_ENTROPY",
                severity="critical",
                score_penalty=45.0,
                details=(
                    f"Critically low pixel entropy ({entropy:.2f} bits / max 8.0). "
                    "Image appears to be a blank screen, solid color, or synthetic test fill."
                ),
            )
        )
    elif entropy < 3.2:
        flags.append(
            CheckFlag(
                code="IMAGE_SUSPICIOUSLY_LOW_ENTROPY",
                severity="low",
                score_penalty=10.0,
                details=f"Low pixel entropy ({entropy:.2f} bits). Check for synthetic graphics or flat backgrounds.",
            )
        )

    return flags
