export type JobName =
  | 'resolution_trigger'
  | 'finalise_trigger'
  | 'undersubscription_cancel'
  | 'ttl_extension_sweep'
  | 'request_assignment'
  | 'audit_scheduling'
  | 'notification_dispatch'
  | 'webhook_delivery';

export interface ResolutionTriggerPayload {
  requestId: string;
  revealDeadline: string;
}

export interface FinaliseTriggerPayload {
  requestId: string;
  challengeWindowEndsAt: string;
}

export interface UnderSubscriptionCancelPayload {
  requestId: string;
  commitDeadline: string;
  minReports: number;
}

export interface TtlExtensionSweepPayload {
  contractIds: string[];
  thresholdLedgers: number;
}

export interface RequestAssignmentPayload {
  requestId: string;
  data_type: string;
  geohash: string;
  seed: string;
}

export interface AuditSchedulingPayload {
  requestId: string;
  sampleRateBps: number;
}

export interface NotificationDispatchPayload {
  toPhone: string;
  message: string;
  taskId: string;
}

export interface WebhookDeliveryPayload {
  webhookId: string;
  url: string;
  secret: string;
  eventType: string;
  data: Record<string, unknown>;
  attempt?: number;
  maxRetries?: number;
}

export interface JobResult {
  jobName: JobName;
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}
