-- MarketPulse Oracle Database Schema - Initial Migration (Up)
-- PostGIS spatial support and core tables

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "postgis";

-- 1. Markets Table
-- Stores geographic market definitions with PostGIS geography point and geohash.
CREATE TABLE IF NOT EXISTS markets (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    city VARCHAR(64) NOT NULL,
    country_code VARCHAR(2) NOT NULL DEFAULT 'NG',
    geohash VARCHAR(12) NOT NULL,
    location GEOGRAPHY(Point, 4326) NOT NULL,
    metadata JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_markets_geohash ON markets (geohash);
CREATE INDEX IF NOT EXISTS idx_markets_country ON markets (country_code);
CREATE INDEX IF NOT EXISTS idx_markets_location ON markets USING GIST (location);

-- 2. Reporters Table
-- Privacy Compliance (NDPR / GDPR): No raw phone numbers stored.
-- Only salted SHA-256 hash and ISO-3166-1 country code are persisted.
-- Retention Policy: Inactive reporter salted hashes retained up to 2 years after account closure for anti-sybil graph analysis.
CREATE TABLE IF NOT EXISTS reporters (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_address VARCHAR(56) UNIQUE NOT NULL,
    phone_hash VARCHAR(64) UNIQUE NOT NULL,
    phone_salt VARCHAR(32) NOT NULL,
    country_code VARCHAR(2) NOT NULL DEFAULT 'NG',
    reputation_score INTEGER NOT NULL DEFAULT 100,
    tier SMALLINT NOT NULL DEFAULT 1,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'banned')),
    stake_cap BIGINT NOT NULL DEFAULT 10000000, -- in stroops (1 USDC = 10,000,000)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE reporters IS 'Reporter identity and reputation. Raw phone numbers are strictly forbidden (salted hash + country code only).';
CREATE INDEX IF NOT EXISTS idx_reporters_wallet ON reporters (wallet_address);
CREATE INDEX IF NOT EXISTS idx_reporters_phone_hash ON reporters (phone_hash);
CREATE INDEX IF NOT EXISTS idx_reporters_status ON reporters (status);

-- 3. Devices Table
-- WebAuthn / Passkey credentials and device fingerprint.
CREATE TABLE IF NOT EXISTS devices (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    reporter_id UUID NOT NULL REFERENCES reporters(id) ON DELETE CASCADE,
    device_fingerprint VARCHAR(64) NOT NULL,
    passkey_credential_id TEXT,
    passkey_public_key TEXT,
    user_agent TEXT,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_reporter_device UNIQUE (reporter_id, device_fingerprint)
);

CREATE INDEX IF NOT EXISTS idx_devices_reporter ON devices (reporter_id);

-- 4. Vouches Table
-- Stake-backed community vouches.
CREATE TABLE IF NOT EXISTS vouches (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    voucher_id UUID NOT NULL REFERENCES reporters(id) ON DELETE CASCADE,
    vouchee_id UUID NOT NULL REFERENCES reporters(id) ON DELETE CASCADE,
    voucher_stake_at_risk BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'slashed', 'released')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_voucher_vouchee UNIQUE (voucher_id, vouchee_id),
    CONSTRAINT chk_no_self_vouch CHECK (voucher_id <> vouchee_id)
);

CREATE INDEX IF NOT EXISTS idx_vouches_voucher ON vouches (voucher_id);
CREATE INDEX IF NOT EXISTS idx_vouches_vouchee ON vouches (vouchee_id);

-- 5. Requests Table
-- On-chain requests mirror.
CREATE TABLE IF NOT EXISTS requests (
    id BIGINT PRIMARY KEY,
    requester VARCHAR(56) NOT NULL,
    data_type VARCHAR(32) NOT NULL,
    geohash VARCHAR(12) NOT NULL,
    bounty BIGINT NOT NULL,
    token VARCHAR(56) NOT NULL,
    min_stake BIGINT NOT NULL,
    tolerance_bps INTEGER NOT NULL,
    commit_deadline TIMESTAMPTZ NOT NULL,
    reveal_deadline TIMESTAMPTZ NOT NULL,
    challenge_window BIGINT NOT NULL,
    min_reports INTEGER NOT NULL,
    max_reports INTEGER NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'revealing', 'resolving', 'challengeable', 'disputed', 'finalised', 'cancelled')),
    created_ledger BIGINT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_requests_lookup ON requests (data_type, geohash, status);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests (status);
CREATE INDEX IF NOT EXISTS idx_requests_deadlines ON requests (commit_deadline, reveal_deadline);

-- 6. Reports Table
-- Commitments and revealed values per request.
CREATE TABLE IF NOT EXISTS reports (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id BIGINT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    reporter_address VARCHAR(56) NOT NULL,
    commitment VARCHAR(64) NOT NULL,
    value BIGINT,
    evidence_hash VARCHAR(64),
    stake BIGINT NOT NULL,
    weight_bps INTEGER NOT NULL,
    revealed BOOLEAN NOT NULL DEFAULT FALSE,
    outcome VARCHAR(32) NOT NULL DEFAULT 'pending' CHECK (outcome IN ('pending', 'accepted', 'outlier_slashed', 'non_reveal_slashed', 'fraud_slashed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revealed_at TIMESTAMPTZ,
    CONSTRAINT uq_request_reporter UNIQUE (request_id, reporter_address)
);

CREATE INDEX IF NOT EXISTS idx_reports_request ON reports (request_id);
CREATE INDEX IF NOT EXISTS idx_reports_reporter ON reports (reporter_address);

-- 7. Observations Table
-- Finalised or challengeable observations readable by buyers and oracle consumers.
CREATE TABLE IF NOT EXISTS observations (
    request_id BIGINT PRIMARY KEY REFERENCES requests(id) ON DELETE CASCADE,
    data_type VARCHAR(32) NOT NULL,
    geohash VARCHAR(12) NOT NULL,
    market_id VARCHAR(64) REFERENCES markets(id),
    value BIGINT NOT NULL,
    decimals SMALLINT NOT NULL DEFAULT 2,
    currency VARCHAR(4) NOT NULL DEFAULT 'NGN',
    confidence_bps INTEGER NOT NULL,
    n_reports INTEGER NOT NULL,
    challenge_status VARCHAR(20) NOT NULL DEFAULT 'closed' CHECK (challenge_status IN ('open', 'disputed', 'closed')),
    evidence_bundle_url TEXT,
    finalised_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for buyer query patterns (README section 19):
-- Query by data_type, geohash prefix, and date range
CREATE INDEX IF NOT EXISTS idx_observations_buyer_query ON observations (data_type, geohash text_pattern_ops, finalised_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_date_range ON observations (finalised_at DESC);
CREATE INDEX IF NOT EXISTS idx_observations_market_latest ON observations (market_id, data_type, finalised_at DESC);

-- 8. Evidence Table
-- Off-chain photo/receipt storage records and cryptographic hashes.
-- Retention Policy: Raw media kept 180 days after resolution; sanitized public media kept 365 days.
CREATE TABLE IF NOT EXISTS evidence (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    evidence_hash VARCHAR(64) UNIQUE NOT NULL,
    storage_key TEXT NOT NULL,
    mime_type VARCHAR(64) NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    exif_stripped_key TEXT,
    check_results JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE evidence IS 'Off-chain evidence files. EXIF metadata is stripped on upload to protect reporter privacy. Retention: 180 days for raw evidence.';
CREATE INDEX IF NOT EXISTS idx_evidence_hash ON evidence (evidence_hash);

-- 9. Flags Table
-- Evidence duplicates, geo anomalies, and wallet correlation flags.
CREATE TABLE IF NOT EXISTS flags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    flag_type VARCHAR(32) NOT NULL CHECK (flag_type IN ('evidence_duplicate', 'geo_distance', 'correlation_cluster', 'timing_suspicious')),
    request_id BIGINT REFERENCES requests(id) ON DELETE CASCADE,
    reporter_address VARCHAR(56) NOT NULL,
    severity VARCHAR(16) NOT NULL CHECK (severity IN ('low', 'medium', 'high', 'critical')),
    details JSONB NOT NULL DEFAULT '{}',
    reviewed BOOLEAN NOT NULL DEFAULT FALSE,
    reviewed_by VARCHAR(56),
    reviewed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flags_reviewed ON flags (reviewed, severity);
CREATE INDEX IF NOT EXISTS idx_flags_reporter ON flags (reporter_address);

-- 10. Audits Table
-- Random ground-truth audits scheduled by worker or admin.
CREATE TABLE IF NOT EXISTS audits (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id BIGINT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    sample_rate_bps INTEGER NOT NULL DEFAULT 500,
    auditor_address VARCHAR(56),
    status VARCHAR(20) NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'in_progress', 'passed', 'failed', 'cancelled')),
    ground_truth_value BIGINT,
    notes TEXT,
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audits_status ON audits (status);
CREATE INDEX IF NOT EXISTS idx_audits_request ON audits (request_id);

-- 11. Payouts Table
-- Mirrored payout records from on-chain ReportEngine claims and resolution.
CREATE TABLE IF NOT EXISTS payouts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    request_id BIGINT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
    reporter_address VARCHAR(56) NOT NULL,
    bounty_reward BIGINT NOT NULL DEFAULT 0,
    stake_returned BIGINT NOT NULL DEFAULT 0,
    slash_bonus BIGINT NOT NULL DEFAULT 0,
    slash_penalty BIGINT NOT NULL DEFAULT 0,
    reason_code VARCHAR(32) NOT NULL DEFAULT 'SUCCESS' CHECK (reason_code IN ('SUCCESS', 'OUTLIER', 'NON_REVEAL', 'FRAUD', 'UNDERSUBSCRIBED_REFUND')),
    claimed BOOLEAN NOT NULL DEFAULT FALSE,
    claimed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payout_reporter UNIQUE (request_id, reporter_address)
);

CREATE INDEX IF NOT EXISTS idx_payouts_reporter ON payouts (reporter_address);
CREATE INDEX IF NOT EXISTS idx_payouts_claimed ON payouts (claimed);

-- 12. API Keys Table
-- Authenticates external buyers and developers with scoped permissions and rate limits.
CREATE TABLE IF NOT EXISTS api_keys (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name VARCHAR(64) NOT NULL,
    key_hash VARCHAR(64) UNIQUE NOT NULL,
    key_prefix VARCHAR(16) NOT NULL,
    tier VARCHAR(16) NOT NULL DEFAULT 'standard' CHECK (tier IN ('trial', 'standard', 'enterprise')),
    scopes TEXT[] NOT NULL DEFAULT ARRAY['read:observations', 'read:markets', 'read:datatypes', 'write:requests'],
    rate_limit_per_min INTEGER NOT NULL DEFAULT 60,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys (key_hash);

-- 13. Webhooks Table
-- Subscribed buyer endpoints for real-time notifications.
CREATE TABLE IF NOT EXISTS webhooks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    api_key_id UUID REFERENCES api_keys(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    event_types TEXT[] NOT NULL DEFAULT ARRAY['observation.finalised', 'request.cancelled'],
    secret VARCHAR(64) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhooks_active ON webhooks (is_active);

-- 14. Event Cursor Table
-- Persists Stellar RPC getEvents stream cursor for seamless indexer resume across restarts.
CREATE TABLE IF NOT EXISTS event_cursor (
    id VARCHAR(32) PRIMARY KEY DEFAULT 'stellar_rpc_cursor',
    cursor TEXT NOT NULL,
    ledger_sequence BIGINT NOT NULL DEFAULT 0,
    last_event_timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 15. Admin Actions Table
-- Audit log of restricted admin actions.
-- Retention Policy: Retained for 3 years for regulatory and transparency auditability.
CREATE TABLE IF NOT EXISTS admin_actions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    admin_address VARCHAR(56) NOT NULL,
    action VARCHAR(64) NOT NULL CHECK (action IN ('suspend_reporter', 'reinstate_reporter', 'review_flag', 'schedule_audit', 'add_datatype', 'update_datatype')),
    target_id TEXT NOT NULL,
    details JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE admin_actions IS 'Immutable audit log of administrative operations. Retained for 3 years.';
CREATE INDEX IF NOT EXISTS idx_admin_actions_action ON admin_actions (action, created_at DESC);
