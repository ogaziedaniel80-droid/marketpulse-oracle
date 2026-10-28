"""Data models for collusion and correlation analytics."""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional
from pydantic import BaseModel, Field

FlagType = Literal[
    "evidence_duplicate",
    "geo_distance",
    "correlation_cluster",
    "timing_suspicious",
]

SeverityLevel = Literal["low", "medium", "high", "critical"]


class DatabaseFlag(BaseModel):
    """Represents a row to be inserted into the PostgreSQL mirror `flags` table.

    Matches packages/shared/migrations/001_initial_schema.up.sql.
    """

    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    flag_type: FlagType
    request_id: Optional[int] = None
    reporter_address: str
    severity: SeverityLevel
    details: Dict[str, Any] = Field(default_factory=dict)
    reviewed: bool = False
    reviewed_by: Optional[str] = None
    reviewed_at: Optional[datetime] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class WalletTransfer(BaseModel):
    tx_hash: str
    from_address: str
    to_address: str
    amount_stroops: int
    timestamp: datetime


class SubmissionEvent(BaseModel):
    request_id: int
    reporter_address: str
    commit_timestamp: datetime
    reveal_timestamp: Optional[datetime] = None
    reported_value: Optional[int] = None
