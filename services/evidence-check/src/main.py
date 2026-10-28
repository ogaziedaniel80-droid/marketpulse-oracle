"""FastAPI application for Evidence Check Service."""
from __future__ import annotations

import base64
from datetime import datetime, timezone
from typing import Optional
from fastapi import FastAPI, File, Form, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from .models import EvidenceCheckMetadata, EvidenceCheckResponse
from .service import EvidenceCheckService

app = FastAPI(
    title="MarketPulse Evidence Check Service",
    version="0.1.0",
    description=(
        "Off-chain service for EXIF parsing, perceptual hash duplicate detection, "
        "geo-plausibility, and tampering heuristics. Outputs advisory flags for disputes."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

service = EvidenceCheckService()


class JsonCheckRequest(BaseModel):
    image_base64: str
    reporter_address: str
    request_id: str
    market_id: str
    geohash: Optional[str] = None
    reported_value: Optional[int] = None
    claimed_timestamp: Optional[datetime] = None


@app.get("/health", status_code=status.HTTP_200_OK)
def health():
    return {
        "status": "healthy",
        "service": "evidence-check",
        "version": "0.1.0",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.post(
    "/check",
    response_model=EvidenceCheckResponse,
    status_code=status.HTTP_200_OK,
    summary="Validate evidence photo and extract advisory dispute flags",
)
async def check_evidence_form(
    image: UploadFile = File(..., description="Evidence image file (JPEG, PNG, WebP)"),
    reporter_address: str = Form(..., description="Stellar address of reporting wallet"),
    request_id: str = Form(..., description="Oracle request ID"),
    market_id: str = Form(..., description="Market identifier (e.g. wuse_abuja)"),
    geohash: Optional[str] = Form(None, description="Coarse market geohash"),
    reported_value: Optional[int] = Form(None, description="Reported price in base units"),
    claimed_timestamp: Optional[str] = Form(None, description="ISO timestamp"),
):
    try:
        image_bytes = await image.read()
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Failed to read image stream: {str(e)}",
        )

    ts = None
    if claimed_timestamp:
        try:
            ts = datetime.fromisoformat(claimed_timestamp.replace("Z", "+00:00"))
        except Exception:
            pass

    metadata = EvidenceCheckMetadata(
        reporter_address=reporter_address,
        request_id=request_id,
        market_id=market_id,
        geohash=geohash,
        reported_value=reported_value,
        claimed_timestamp=ts,
    )

    return service.check_evidence(image_bytes, metadata)


@app.post(
    "/check/json",
    response_model=EvidenceCheckResponse,
    status_code=status.HTTP_200_OK,
    summary="Validate base64 encoded evidence photo and extract advisory dispute flags",
)
def check_evidence_json(payload: JsonCheckRequest):
    try:
        # Strip data URL prefix if present
        raw_b64 = payload.image_base64
        if "," in raw_b64:
            raw_b64 = raw_b64.split(",", 1)[1]
        image_bytes = base64.b64decode(raw_b64)
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid base64 payload: {str(e)}",
        )

    metadata = EvidenceCheckMetadata(
        reporter_address=payload.reporter_address,
        request_id=payload.request_id,
        market_id=payload.market_id,
        geohash=payload.geohash,
        reported_value=payload.reported_value,
        claimed_timestamp=payload.claimed_timestamp,
    )

    return service.check_evidence(image_bytes, metadata)
