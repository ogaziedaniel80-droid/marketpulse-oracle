"""Market geofence coordinates and geo-plausibility verification."""
from __future__ import annotations

import math
from typing import Dict, List, Optional
from .models import CheckFlag, ExifMetadata

# Known pilot markets with center coordinates and radius in meters
MARKET_GEOFENCES: Dict[str, Dict[str, float]] = {
    "wuse_abuja": {
        "lat": 9.0722,
        "lon": 7.4646,
        "radius_m": 1500.0,
        "tolerance_m": 4000.0,
    },
    "garki_abuja": {
        "lat": 9.0256,
        "lon": 7.4891,
        "radius_m": 1500.0,
        "tolerance_m": 4000.0,
    },
    "utako_abuja": {
        "lat": 9.0614,
        "lon": 7.4418,
        "radius_m": 1500.0,
        "tolerance_m": 4000.0,
    },
    "bodija_ibadan": {
        "lat": 7.4343,
        "lon": 3.9114,
        "radius_m": 2000.0,
        "tolerance_m": 5000.0,
    },
    "mile12_lagos": {
        "lat": 6.6111,
        "lon": 3.3905,
        "radius_m": 2000.0,
        "tolerance_m": 5000.0,
    },
}


def haversine_distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate the great circle distance between two points on the earth in meters."""
    R = 6371000.0  # Earth radius in meters
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)

    a = (
        math.sin(delta_phi / 2.0) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(delta_lambda / 2.0) ** 2
    )
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c


def validate_geoplausibility(
    exif: ExifMetadata,
    market_id: str,
) -> List[CheckFlag]:
    """Verify that EXIF GPS coordinates (if present) are within plausible distance of market geofence."""
    flags: List[CheckFlag] = []

    if exif.gps_latitude is None or exif.gps_longitude is None:
        # Note: GPS info is often omitted for privacy or device limitations
        return flags

    market = MARKET_GEOFENCES.get(market_id.lower())
    if not market:
        # Unknown market geofence, cannot verify
        return flags

    dist = haversine_distance_m(
        exif.gps_latitude,
        exif.gps_longitude,
        market["lat"],
        market["lon"],
    )

    max_allowed = market["radius_m"] + market["tolerance_m"]

    if dist > max_allowed:
        # Significant deviation: photo was taken far from the reported market
        dist_km = dist / 1000.0
        flags.append(
            CheckFlag(
                code="GEO_OUT_OF_BOUNDS",
                severity="critical" if dist_km > 20.0 else "high",
                score_penalty=40.0 if dist_km > 20.0 else 25.0,
                details=(
                    f"Photo GPS coordinates ({exif.gps_latitude:.4f}, {exif.gps_longitude:.4f}) "
                    f"are {dist_km:.1f} km away from market center ({market_id}). "
                    f"Maximum allowed distance is {max_allowed / 1000.0:.1f} km."
                ),
            )
        )

    return flags
