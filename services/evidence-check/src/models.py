"""Data models for evidence check service."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field


SeverityLevel = Literal["low", "medium", "high", "critical"]


class CheckFlag(BaseModel):
    """Advisory flag raised by evidence checks.

    Per README section 13: Flags are advisory and feed the dispute flow;
    they do not unilaterally slash on-chain.
    """

    code: str = Field(..., description="Machine-readable reason code")
    severity: SeverityLevel = Field(..., description="Flag severity")
    score_penalty: float = Field(..., description="Trust score deduction (0-100)")
    details: str = Field(..., description="Human-readable explanation for arbiters and reports")


class ExifMetadata(BaseModel):
    has_exif: bool = False
    timestamp: Optional[datetime] = None
    make: Optional[str] = None
    model: Optional[str] = None
    software: Optional[str] = None
    gps_latitude: Optional[float] = None
    gps_longitude: Optional[float] = None
    gps_altitude: Optional[float] = None


class EvidenceCheckMetadata(BaseModel):
    reporter_address: str = Field(..., description="Stellar G... address of submitting reporter")
    request_id: str = Field(..., description="MarketPulse request identifier")
    market_id: str = Field(..., description="Market identifier (e.g. wuse_abuja)")
    geohash: Optional[str] = Field(None, description="Reported coarse geohash (e.g. s0zc9)")
    reported_value: Optional[int] = Field(None, description="Reported price in base units")
    claimed_timestamp: Optional[datetime] = Field(None, description="Time of report submission")


class EvidenceCheckResponse(BaseModel):
    valid: bool = Field(..., description="Whether evidence passes minimum integrity checks")
    trust_score: float = Field(..., ge=0.0, le=100.0, description="Overall trust score out of 100")
    evidence_sha256: str = Field(..., description="Cryptographic SHA-256 hash of evidence")
    perceptual_hash: str = Field(..., description="Difference/Perceptual hash (dHash hex)")
    exif: ExifMetadata
    flags: List[CheckFlag]
    advisory_notice: str = (
        "Advisory only: Flags feed dispute workflows and arbiter reviews. "
        "They do not unilaterally slash on-chain stakes (README §13)."
    )
