import crypto from 'node:crypto';

export interface AdminFlagItem {
  id: string;
  flagType: 'evidence_duplicate' | 'geo_distance' | 'correlation_cluster' | 'timing_suspicious';
  requestId: string;
  reporterAddress: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: Record<string, unknown>;
  reviewed: boolean;
  reviewedBy?: string;
  createdAtIso: string;
}

export interface AdminSuspensionAuditEntry {
  auditLogId: string;
  reporterId: string;
  action: 'suspend' | 'reinstate';
  newStatus: 'suspended' | 'active';
  reason: string;
  adminAddress: string;
  timestampIso: string;
}

export interface AdminScheduledAudit {
  auditId: string;
  requestId: string;
  sampleRateBps: number;
  auditorAddress: string | null;
  status: 'scheduled' | 'completed';
  notes: string | null;
  createdAtIso: string;
}

export class AdminOperationsManager {
  private flags: AdminFlagItem[] = [];
  private reporterStatuses = new Map<string, 'active' | 'suspended'>();
  private auditLogs: AdminSuspensionAuditEntry[] = [];
  private scheduledAudits: AdminScheduledAudit[] = [];

  public seedFlags(items: AdminFlagItem[]): void {
    this.flags.push(...items);
  }

  public reviewFlags(filter?: {
    reviewed?: boolean;
    severity?: 'low' | 'medium' | 'high' | 'critical';
  }): AdminFlagItem[] {
    return this.flags.filter((f) => {
      if (filter?.reviewed !== undefined && f.reviewed !== filter.reviewed) return false;
      if (filter?.severity && f.severity !== filter.severity) return false;
      return true;
    });
  }

  public markFlagReviewed(flagId: string, adminAddress: string): AdminFlagItem {
    const item = this.flags.find((f) => f.id === flagId);
    if (!item) throw new Error(`FlagNotFound: ${flagId}`);
    item.reviewed = true;
    item.reviewedBy = adminAddress;
    return item;
  }

  public updateReporterStatus(params: {
    reporterId: string;
    action: 'suspend' | 'reinstate';
    reason: string;
    adminAddress: string;
  }): AdminSuspensionAuditEntry {
    if (params.reason.trim().length < 5) {
      throw new Error(
        'ValidationError: Suspension/reinstatement reason must be at least 5 characters',
      );
    }

    const newStatus = params.action === 'suspend' ? 'suspended' : 'active';
    this.reporterStatuses.set(params.reporterId, newStatus);

    const entry: AdminSuspensionAuditEntry = {
      auditLogId: `audit_log_${crypto.randomBytes(6).toString('hex')}`,
      reporterId: params.reporterId,
      action: params.action,
      newStatus,
      reason: params.reason,
      adminAddress: params.adminAddress,
      timestampIso: new Date().toISOString(),
    };

    this.auditLogs.push(entry);
    return entry;
  }

  public scheduleGroundTruthAudit(params: {
    requestId: string;
    sampleRateBps?: number;
    auditorAddress?: string;
    notes?: string;
  }): AdminScheduledAudit {
    const rate = params.sampleRateBps ?? 800; // Default 8%
    if (rate < 100 || rate > 10000) {
      throw new Error('ValidationError: sampleRateBps must be between 100 (1%) and 10000 (100%)');
    }

    const scheduled: AdminScheduledAudit = {
      auditId: `aud_${crypto.randomBytes(6).toString('hex')}`,
      requestId: params.requestId,
      sampleRateBps: rate,
      auditorAddress: params.auditorAddress ?? null,
      status: 'scheduled',
      notes: params.notes ?? null,
      createdAtIso: new Date().toISOString(),
    };

    this.scheduledAudits.push(scheduled);
    return scheduled;
  }

  public listScheduledAudits(): AdminScheduledAudit[] {
    return [...this.scheduledAudits];
  }
}
