"""EXIF metadata and timestamp extraction and validation."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple
from PIL import ExifTags, Image

from .models import CheckFlag, ExifMetadata

SUSPICIOUS_SOFTWARE_KEYWORDS = [
    "photoshop",
    "gimp",
    "lightroom",
    "canva",
    "figma",
    "paint.net",
    "snapseed",
    "midjourney",
    "stable diffusion",
]


def _convert_dms_to_decimal(dms: Any, ref: Optional[str]) -> Optional[float]:
    """Convert degrees, minutes, seconds tuple or ratio to decimal degrees."""
    try:
        degrees = float(dms[0])
        minutes = float(dms[1])
        seconds = float(dms[2])
        dec = degrees + (minutes / 60.0) + (seconds / 3600.0)
        if ref in ("S", "W"):
            dec = -dec
        return round(dec, 6)
    except Exception:
        return None


def extract_exif(image: Image.Image) -> ExifMetadata:
    """Extract raw EXIF tags from PIL image."""
    meta = ExifMetadata(has_exif=False)
    exif = None

    try:
        exif = image.getexif()
    except Exception:
        return meta

    if not exif:
        return meta

    meta.has_exif = True

    # Reverse lookup ExifTags
    tag_map: Dict[str, Any] = {}
    for tag_id, val in exif.items():
        name = ExifTags.TAGS.get(tag_id, str(tag_id))
        tag_map[name] = val

    if "Make" in tag_map:
        meta.make = str(tag_map["Make"]).strip()
    if "Model" in tag_map:
        meta.model = str(tag_map["Model"]).strip()
    if "Software" in tag_map:
        meta.software = str(tag_map["Software"]).strip()

    # Parse timestamps
    for date_key in ("DateTimeOriginal", "DateTimeDigitized", "DateTime"):
        if date_key in tag_map:
            try:
                date_str = str(tag_map[date_key]).strip()
                # Typical EXIF format: 'YYYY:MM:DD HH:MM:SS'
                meta.timestamp = datetime.strptime(date_str, "%Y:%m:%d %H:%M:%S")
                break
            except Exception:
                pass

    # Parse GPS IFD if present
    gps_ifd = exif.get_ifd(ExifTags.IFD.GPSInfo) if hasattr(exif, "get_ifd") else None
    if gps_ifd:
        gps_tags = {}
        for k, v in gps_ifd.items():
            gps_tags[ExifTags.GPSTAGS.get(k, str(k))] = v

        lat_dms = gps_tags.get("GPSLatitude")
        lat_ref = gps_tags.get("GPSLatitudeRef")
        lon_dms = gps_tags.get("GPSLongitude")
        lon_ref = gps_tags.get("GPSLongitudeRef")

        if lat_dms and lon_dms:
            meta.gps_latitude = _convert_dms_to_decimal(lat_dms, lat_ref)
            meta.gps_longitude = _convert_dms_to_decimal(lon_dms, lon_ref)

        if "GPSAltitude" in gps_tags:
            try:
                meta.gps_altitude = float(gps_tags["GPSAltitude"])
            except Exception:
                pass

    return meta


def validate_exif(
    meta: ExifMetadata, claimed_timestamp: Optional[datetime] = None
) -> List[CheckFlag]:
    """Validate extracted EXIF against reporting context and generate advisory flags."""
    flags: List[CheckFlag] = []

    if not meta.has_exif:
        flags.append(
            CheckFlag(
                code="EXIF_MISSING",
                severity="low",
                score_penalty=5.0,
                details="No EXIF metadata found. Image may have been re-encoded by browser or messaging app.",
            )
        )
        return flags

    # Check for image editing software
    if meta.software:
        software_lower = meta.software.lower()
        for kw in SUSPICIOUS_SOFTWARE_KEYWORDS:
            if kw in software_lower:
                flags.append(
                    CheckFlag(
                        code="SUSPICIOUS_SOFTWARE",
                        severity="medium",
                        score_penalty=20.0,
                        details=f"Image indicates editing software in EXIF: '{meta.software}'.",
                    )
                )
                break

    # Check timestamp plausibility
    if meta.timestamp and claimed_timestamp:
        t_meta = meta.timestamp.replace(tzinfo=None)
        t_claim = claimed_timestamp.replace(tzinfo=None)
        skew = abs((t_meta - t_claim).total_seconds())
        # > 48 hours difference suggests recycled old photo
        if skew > 172800:
            flags.append(
                CheckFlag(
                    code="EXIF_TIMESTAMP_SKEW_CRITICAL",
                    severity="high",
                    score_penalty=30.0,
                    details=(
                        f"Photo capture date ({meta.timestamp.isoformat()}) differs from report submission "
                        f"by {skew / 86400:.1f} days. Likely recycled photo."
                    ),
                )
            )
        elif skew > 86400:
            flags.append(
                CheckFlag(
                    code="EXIF_TIMESTAMP_SKEW",
                    severity="medium",
                    score_penalty=15.0,
                    details=(
                        f"Photo capture date ({meta.timestamp.isoformat()}) differs from report submission "
                        f"by {skew / 3600:.1f} hours."
                    ),
                )
            )

    return flags
