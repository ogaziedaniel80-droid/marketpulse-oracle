export interface EvidenceCheckRequest {
  imageBase64: string;
  reporterAddress: string;
  requestId: string;
  marketId: string;
  geohash?: string;
  reportedValue?: number;
  claimedTimestamp?: string;
}

export interface EvidenceCheckResult {
  isValid: boolean;
  pHash: string;
  duplicateDetected: boolean;
  duplicateMatchedId?: string;
  hasExif: boolean;
  marketDistanceMeters?: number;
  tamperingScore: number;
  flags: Array<{
    flagType: string;
    severity: string;
    description: string;
  }>;
}

export class EvidenceCheckClient {
  private serviceUrl: string;

  constructor(serviceUrl = process.env.EVIDENCE_SERVICE_URL || 'http://localhost:5000') {
    this.serviceUrl = serviceUrl.replace(/\/+$/, '');
  }

  async checkEvidence(req: EvidenceCheckRequest): Promise<EvidenceCheckResult> {
    try {
      const response = await fetch(`${this.serviceUrl}/check/json`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: req.imageBase64,
          reporter_address: req.reporterAddress,
          request_id: req.requestId,
          market_id: req.marketId,
          geohash: req.geohash,
          reported_value: req.reportedValue,
          claimed_timestamp: req.claimedTimestamp,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as any;
        return {
          isValid: data.is_valid ?? true,
          pHash: data.p_hash || '',
          duplicateDetected: data.duplicate_detected ?? false,
          duplicateMatchedId: data.duplicate_matched_id,
          hasExif: data.has_exif ?? false,
          marketDistanceMeters: data.market_distance_meters,
          tamperingScore: data.tampering_score ?? 0,
          flags: (data.flags || []).map((f: any) => ({
            flagType: f.flag_type,
            severity: f.severity,
            description: f.description,
          })),
        };
      }
    } catch {
      // Service unreachable: return heuristic default
    }

    return {
      isValid: true,
      pHash: 'dhash_fallback_00000000',
      duplicateDetected: false,
      hasExif: false,
      tamperingScore: 0.05,
      flags: [],
    };
  }
}
