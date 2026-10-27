/**
 * Database schema entity interfaces matching PostgreSQL schema.
 */

export interface MarketRow {
  id: string;
  name: string;
  city: string;
  country_code: string;
  geohash: string;
  location?: unknown;
  metadata: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}

export interface ReporterRow {
  id: string;
  wallet_address: string;
  phone_hash: string;
  phone_salt: string;
  country_code: string;
  reputation_score: number;
  tier: number;
  status: 'active' | 'suspended' | 'banned';
  stake_cap: string;
  created_at: Date;
  updated_at: Date;
}

export interface DeviceRow {
  id: string;
  reporter_id: string;
  device_fingerprint: string;
  passkey_credential_id?: string | null;
  passkey_public_key?: string | null;
  user_agent?: string | null;
  last_seen_at: Date;
  created_at: Date;
}

export interface VouchRow {
  id: string;
  voucher_id: string;
  vouchee_id: string;
  voucher_stake_at_risk: string;
  status: 'active' | 'slashed' | 'released';
  created_at: Date;
  updated_at: Date;
}

export interface RequestRow {
  id: string;
  requester: string;
  data_type: string;
  geohash: string;
  bounty: string;
  token: string;
  min_stake: string;
  tolerance_bps: number;
  commit_deadline: Date;
  reveal_deadline: Date;
  challenge_window: string;
  min_reports: number;
  max_reports: number;
  status:
    'open' | 'revealing' | 'resolving' | 'challengeable' | 'disputed' | 'finalised' | 'cancelled';
  created_ledger: string;
  created_at: Date;
  updated_at: Date;
}

export interface ReportRow {
  id: string;
  request_id: string;
  reporter_address: string;
  commitment: string;
  value?: string | null;
  evidence_hash?: string | null;
  stake: string;
  weight_bps: number;
  revealed: boolean;
  outcome: 'pending' | 'accepted' | 'outlier_slashed' | 'non_reveal_slashed' | 'fraud_slashed';
  created_at: Date;
  revealed_at?: Date | null;
}

export interface ObservationRow {
  request_id: string;
  data_type: string;
  geohash: string;
  market_id?: string | null;
  value: string;
  decimals: number;
  currency: string;
  confidence_bps: number;
  n_reports: number;
  challenge_status: 'open' | 'disputed' | 'closed';
  evidence_bundle_url?: string | null;
  finalised_at: Date;
  created_at: Date;
}

export interface EvidenceRow {
  id: string;
  evidence_hash: string;
  storage_key: string;
  mime_type: string;
  file_size_bytes: number;
  exif_stripped_key?: string | null;
  check_results: Record<string, unknown>;
  created_at: Date;
}

export interface FlagRow {
  id: string;
  flag_type: 'evidence_duplicate' | 'geo_distance' | 'correlation_cluster' | 'timing_suspicious';
  request_id?: string | null;
  reporter_address: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: Record<string, unknown>;
  reviewed: boolean;
  reviewed_by?: string | null;
  reviewed_at?: Date | null;
  created_at: Date;
}

export interface AuditRow {
  id: string;
  request_id: string;
  sample_rate_bps: number;
  auditor_address?: string | null;
  status: 'scheduled' | 'in_progress' | 'passed' | 'failed' | 'cancelled';
  ground_truth_value?: string | null;
  notes?: string | null;
  completed_at?: Date | null;
  created_at: Date;
}

export interface PayoutRow {
  id: string;
  request_id: string;
  reporter_address: string;
  bounty_reward: string;
  stake_returned: string;
  slash_bonus: string;
  slash_penalty: string;
  reason_code: 'SUCCESS' | 'OUTLIER' | 'NON_REVEAL' | 'FRAUD' | 'UNDERSUBSCRIBED_REFUND';
  claimed: boolean;
  claimed_at?: Date | null;
  created_at: Date;
}

export interface ApiKeyRow {
  id: string;
  name: string;
  key_hash: string;
  key_prefix: string;
  tier: 'trial' | 'standard' | 'enterprise';
  scopes: string[];
  rate_limit_per_min: number;
  is_active: boolean;
  created_at: Date;
  last_used_at?: Date | null;
}

export interface WebhookRow {
  id: string;
  api_key_id?: string | null;
  url: string;
  event_types: string[];
  secret: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface EventCursorRow {
  id: string;
  cursor: string;
  ledger_sequence: string;
  last_event_timestamp: Date;
  updated_at: Date;
}

export interface AdminActionRow {
  id: string;
  admin_address: string;
  action:
    | 'suspend_reporter'
    | 'reinstate_reporter'
    | 'review_flag'
    | 'schedule_audit'
    | 'add_datatype'
    | 'update_datatype';
  target_id: string;
  details: Record<string, unknown>;
  created_at: Date;
}
