"""Unit and integration tests for Evidence Check Service using synthetic samples."""
from __future__ import annotations

import io
import random
from datetime import datetime, timedelta, timezone
from PIL import ExifTags, Image, ImageDraw
import pytest
from fastapi.testclient import TestClient

from src.main import app, service
from src.models import EvidenceCheckMetadata
from src.hasher import PerceptualHashStore, compute_dhash, compute_sha256, hamming_distance
from src.geofence import haversine_distance_m


client = TestClient(app)


def create_synthetic_image(
    width: int = 640,
    height: int = 480,
    pattern: str = "noise",
    make: str = "Samsung",
    model: str = "Galaxy A14",
    software: str = None,
    gps_coords: tuple[float, float] = None,
    timestamp: datetime = None,
) -> bytes:
    """Generate a deterministic synthetic image with optional EXIF tags."""
    img = Image.new("RGB", (width, height))
    draw = ImageDraw.Draw(img)

    if pattern == "solid":
        draw.rectangle([0, 0, width, height], fill=(120, 120, 120))
    elif pattern == "gradient":
        for y in range(height):
            c = int(255 * (y / height))
            draw.line([(0, y), (width, y)], fill=(c, c, c))
    else:  # rich texture / noise simulating a market scene
        rng = random.Random(42)
        pixels = []
        for _ in range(width * height):
            r = rng.randint(50, 200)
            g = rng.randint(40, 180)
            b = rng.randint(30, 160)
            pixels.append((r, g, b))
        img.putdata(pixels)
        # Draw some synthetic stall edges and price boards
        draw.rectangle([50, 50, 250, 200], fill=(210, 180, 140), outline=(50, 30, 20))
        draw.rectangle([300, 100, 500, 350], fill=(180, 50, 50), outline=(20, 20, 20))

    # Add synthetic EXIF
    exif = img.getexif()
    if make:
        exif[ExifTags.Base.Make] = make
    if model:
        exif[ExifTags.Base.Model] = model
    if software:
        exif[ExifTags.Base.Software] = software
    if timestamp:
        exif[ExifTags.Base.DateTimeOriginal] = timestamp.strftime("%Y:%m:%d %H:%M:%S")

    if gps_coords:
        lat, lon = gps_coords
        gps_ifd = exif.get_ifd(ExifTags.IFD.GPSInfo)

        def to_dms_floats(val: float):
            d = float(int(abs(val)))
            remainder_minutes = (abs(val) - d) * 60.0
            m = float(int(remainder_minutes))
            s = float(round((remainder_minutes - m) * 60.0, 2))
            return (d, m, s)

        gps_ifd[ExifTags.GPS.GPSLatitudeRef] = "N" if lat >= 0 else "S"
        gps_ifd[ExifTags.GPS.GPSLatitude] = to_dms_floats(lat)
        gps_ifd[ExifTags.GPS.GPSLongitudeRef] = "E" if lon >= 0 else "W"
        gps_ifd[ExifTags.GPS.GPSLongitude] = to_dms_floats(lon)
        exif[0x8825] = gps_ifd

    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    return buf.getvalue()


@pytest.fixture(autouse=True)
def reset_hash_store():
    service.hash_store.clear()


class TestEvidenceCheckSuite:
    def test_health_endpoint(self):
        resp = client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "healthy"
        assert data["service"] == "evidence-check"

    def test_valid_honest_reporter_sample(self):
        """Honest reporter in Wuse Market with mobile camera EXIF."""
        now = datetime.now(timezone.utc)
        # Wuse Market coords: 9.0722 N, 7.4646 E
        sample = create_synthetic_image(
            width=800,
            height=600,
            pattern="noise",
            make="Transsion",
            model="Tecno Spark 10",
            gps_coords=(9.0725, 7.4650),
            timestamp=now - timedelta(minutes=5),
        )

        metadata = EvidenceCheckMetadata(
            reporter_address="GAHONEST11111111111111111111111111111111111111111111111111",
            request_id="req_wuse_rice_001",
            market_id="wuse_abuja",
            geohash="s0zc9",
            reported_value=82000,
            claimed_timestamp=now,
        )

        res = service.check_evidence(sample, metadata)
        assert res.valid is True
        assert res.trust_score >= 90.0
        assert len(res.flags) == 0
        assert res.exif.make == "Transsion"
        assert res.exif.model == "Tecno Spark 10"
        assert res.exif.gps_latitude is not None

    def test_blank_solid_screen_flagged_for_low_entropy(self):
        """Sybil tries to pass off a blank grey screen."""
        solid_img = create_synthetic_image(width=640, height=480, pattern="solid")
        metadata = EvidenceCheckMetadata(
            reporter_address="GASOLID22222222222222222222222222222222222222222222222222",
            request_id="req_garki_rice_002",
            market_id="garki_abuja",
        )

        res = service.check_evidence(solid_img, metadata)
        assert any(f.code == "IMAGE_LOW_ENTROPY" for f in res.flags)
        assert res.trust_score < 60.0

    def test_low_resolution_image_flagged(self):
        """Tiny 120x90 thumbnail uploaded instead of full photo."""
        tiny_img = create_synthetic_image(width=120, height=90, pattern="noise")
        metadata = EvidenceCheckMetadata(
            reporter_address="GATINY33333333333333333333333333333333333333333333333333",
            request_id="req_utako_rice_003",
            market_id="utako_abuja",
        )

        res = service.check_evidence(tiny_img, metadata)
        assert any(f.code == "IMAGE_RESOLUTION_TOO_LOW" for f in res.flags)

    def test_cross_reporter_duplicate_detection(self):
        """Colluding reporters share the exact same photo."""
        shared_photo = create_synthetic_image(width=640, height=480, pattern="noise")

        # Reporter 1 submits first
        meta1 = EvidenceCheckMetadata(
            reporter_address="GACOLLUDER111111111111111111111111111111111111111111111111",
            request_id="req_wuse_rice_004",
            market_id="wuse_abuja",
        )
        res1 = service.check_evidence(shared_photo, meta1)
        assert not any(f.code == "IMAGE_DUPLICATE_CROSS_REPORTER" for f in res1.flags)

        # Reporter 2 submits the exact same photo
        meta2 = EvidenceCheckMetadata(
            reporter_address="GACOLLUDER222222222222222222222222222222222222222222222222",
            request_id="req_wuse_rice_004",
            market_id="wuse_abuja",
        )
        res2 = service.check_evidence(shared_photo, meta2)
        assert any(f.code == "IMAGE_DUPLICATE_CROSS_REPORTER" for f in res2.flags)
        assert res2.trust_score < 70.0

    def test_temporal_photo_recycling(self):
        """Same reporter re-submits old photo for a new request."""
        recycled_photo = create_synthetic_image(width=640, height=480, pattern="noise")

        meta1 = EvidenceCheckMetadata(
            reporter_address="GALAZY44444444444444444444444444444444444444444444444444",
            request_id="req_day_1",
            market_id="wuse_abuja",
        )
        service.check_evidence(recycled_photo, meta1)

        meta2 = EvidenceCheckMetadata(
            reporter_address="GALAZY44444444444444444444444444444444444444444444444444",
            request_id="req_day_2",
            market_id="wuse_abuja",
        )
        res2 = service.check_evidence(recycled_photo, meta2)
        assert any(f.code == "IMAGE_DUPLICATE_TEMPORAL" for f in res2.flags)

    def test_geofence_out_of_bounds_flagged(self):
        """Photo GPS indicates location far from Abuja market (e.g. Lagos, ~530 km away)."""
        lagos_coords = (6.5244, 3.3792)  # Lagos
        photo = create_synthetic_image(
            width=640,
            height=480,
            gps_coords=lagos_coords,
        )

        metadata = EvidenceCheckMetadata(
            reporter_address="GAREMOTE55555555555555555555555555555555555555555555555555",
            request_id="req_wuse_rice_005",
            market_id="wuse_abuja",
        )

        res = service.check_evidence(photo, metadata)
        assert any(f.code == "GEO_OUT_OF_BOUNDS" for f in res.flags)
        assert res.trust_score <= 75.0

    def test_suspicious_editing_software_detected(self):
        """EXIF reports Adobe Photoshop modification."""
        edited_photo = create_synthetic_image(
            width=640,
            height=480,
            software="Adobe Photoshop CC 2024 (Windows)",
        )

        metadata = EvidenceCheckMetadata(
            reporter_address="GAEDITED66666666666666666666666666666666666666666666666666",
            request_id="req_wuse_rice_006",
            market_id="wuse_abuja",
        )

        res = service.check_evidence(edited_photo, metadata)
        assert any(f.code == "SUSPICIOUS_SOFTWARE" for f in res.flags)

    def test_fastapi_multipart_upload(self):
        """End-to-end HTTP POST /check form test."""
        img_bytes = create_synthetic_image(width=640, height=480)
        files = {"image": ("rice_evidence.jpg", img_bytes, "image/jpeg")}
        data = {
            "reporter_address": "GAHTTPTEST777777777777777777777777777777777777777777777777",
            "request_id": "req_api_001",
            "market_id": "wuse_abuja",
            "geohash": "s0zc9",
            "reported_value": "83000",
        }

        resp = client.post("/check", data=data, files=files)
        assert resp.status_code == 200
        json_data = resp.json()
        assert json_data["valid"] is True
        assert "evidence_sha256" in json_data
        assert "perceptual_hash" in json_data
        assert "advisory_notice" in json_data
