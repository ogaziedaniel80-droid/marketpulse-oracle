import crypto from 'node:crypto';

// --- 1. SMS Provider Interface & Africa's Talking Mock ---

export interface SendSmsOptions {
  to: string; // phone number (E.164)
  message: string;
  senderId?: string;
}

export interface SmsSendResult {
  success: boolean;
  messageId: string;
  recipient: string;
  cost?: string;
  status: 'Success' | 'Failed';
}

export interface SmsProvider {
  sendSms(options: SendSmsOptions): Promise<SmsSendResult>;
  verifyDelivery(messageId: string): Promise<boolean>;
}

export class MockSmsProvider implements SmsProvider {
  public sentMessages: Array<SendSmsOptions & { messageId: string; timestamp: Date }> = [];
  public deliveredIds = new Set<string>();

  async sendSms(options: SendSmsOptions): Promise<SmsSendResult> {
    const messageId = `AT_MSG_${crypto.randomBytes(8).toString('hex')}`;
    this.sentMessages.push({
      ...options,
      messageId,
      timestamp: new Date(),
    });
    this.deliveredIds.add(messageId);

    return {
      success: true,
      messageId,
      recipient: options.to,
      cost: 'NGN 4.00',
      status: 'Success',
    };
  }

  async verifyDelivery(messageId: string): Promise<boolean> {
    return this.deliveredIds.has(messageId);
  }

  getLastOtp(to: string): string | null {
    const msgs = this.sentMessages.filter((m) => m.to === to);
    if (msgs.length === 0) return null;
    const last = msgs[msgs.length - 1];
    const match = last.message.match(/\b\d{6}\b/);
    return match ? match[0] : null;
  }

  clear(): void {
    this.sentMessages = [];
    this.deliveredIds.clear();
  }
}

// --- 2. Relayer Interface & Local Fee-Bump Mock ---

export interface RelayTransactionParams {
  transactionXdr: string;
  sponsorAddress?: string;
  simulated?: boolean;
}

export interface RelayResult {
  success: boolean;
  hash: string;
  ledger: number;
  status: 'PENDING' | 'SUCCESS' | 'FAILED';
  envelopeXdr: string;
  feeChargedStroops: string;
}

export interface RelayerBalance {
  balanceUsdc: string;
  balanceXlm: string;
  address: string;
}

export interface Relayer {
  relay(params: RelayTransactionParams): Promise<RelayResult>;
  getBalance(): Promise<RelayerBalance>;
  simulate(transactionXdr: string): Promise<{ success: boolean; minResourceFee: string }>;
}

export class MockRelayer implements Relayer {
  public relayerAddress: string;
  public balanceUsdc: bigint = 5000000000n; // 500 USDC
  public balanceXlm: bigint = 10000000000n; // 1,000 XLM
  public currentLedger = 105200;
  public relayedTransactions: Array<{ xdr: string; hash: string; timestamp: Date }> = [];
  public failNext = false;

  constructor(address = 'GRELAYER000000000000000000000000000000000000000000000000') {
    this.relayerAddress = address;
  }

  async relay(params: RelayTransactionParams): Promise<RelayResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('Relayer submission failed: Insufficient fee sponsorship budget');
    }
    this.currentLedger += 1;
    const hash = crypto.createHash('sha256').update(params.transactionXdr).digest('hex');

    // Sponsor fee (e.g. 1,000,000 stroops = 0.1 XLM)
    const feeCharged = 1000000n;
    if (this.balanceXlm >= feeCharged) {
      this.balanceXlm -= feeCharged;
    }

    this.relayedTransactions.push({
      xdr: params.transactionXdr,
      hash,
      timestamp: new Date(),
    });

    return {
      success: true,
      hash,
      ledger: this.currentLedger,
      status: 'SUCCESS',
      envelopeXdr: `FEE_BUMP_${params.transactionXdr}`,
      feeChargedStroops: feeCharged.toString(),
    };
  }

  async getBalance(): Promise<RelayerBalance> {
    return {
      balanceUsdc: (Number(this.balanceUsdc) / 10000000).toFixed(2),
      balanceXlm: (Number(this.balanceXlm) / 10000000).toFixed(2),
      address: this.relayerAddress,
    };
  }

  async simulate(_transactionXdr: string): Promise<{ success: boolean; minResourceFee: string }> {
    return {
      success: true,
      minResourceFee: '10000',
    };
  }
}

// --- 3. Object Storage Interface & S3/MinIO Mock ---

export interface UploadOptions {
  bucket?: string;
  key: string;
  content: Buffer | Uint8Array;
  contentType: string;
  expectedSha256?: string; // Client-supplied SHA-256
  stripExif?: boolean;
}

export interface UploadResult {
  key: string;
  bucket: string;
  sha256: string;
  size: number;
  publicUrl: string;
  exifStrippedKey?: string;
}

export interface ObjectStorage {
  upload(options: UploadOptions): Promise<UploadResult>;
  get(key: string, bucket?: string): Promise<{ content: Buffer; contentType: string } | null>;
  delete(key: string, bucket?: string): Promise<boolean>;
  getPublicUrl(key: string, bucket?: string): string;
}

export class EvidenceHashMismatchError extends Error {
  constructor(expected: string, actual: string) {
    super(
      `Evidence SHA-256 hash mismatch: expected client hash ${expected}, server computed ${actual}`,
    );
    this.name = 'EvidenceHashMismatchError';
  }
}

export class MockObjectStorage implements ObjectStorage {
  public defaultBucket = 'marketpulse-evidence';
  public files = new Map<string, { content: Buffer; contentType: string }>();

  async upload(options: UploadOptions): Promise<UploadResult> {
    const bucket = options.bucket || this.defaultBucket;
    const buf = Buffer.isBuffer(options.content) ? options.content : Buffer.from(options.content);

    // Compute cryptographic SHA-256 hash of payload
    const actualSha256 = crypto.createHash('sha256').update(buf).digest('hex');

    // Strict validation: if client provided expectedSha256, it must match byte-for-byte
    if (
      options.expectedSha256 &&
      options.expectedSha256.toLowerCase() !== actualSha256.toLowerCase()
    ) {
      throw new EvidenceHashMismatchError(options.expectedSha256, actualSha256);
    }

    const fullKey = `${bucket}/${options.key}`;
    this.files.set(fullKey, { content: buf, contentType: options.contentType });

    let exifStrippedKey: string | undefined;
    if (options.stripExif !== false) {
      // Simulate EXIF stripping for privacy protection (NDPR / GDPR)
      // Removes camera model, GPS coordinates, timestamp from raw bytes
      exifStrippedKey = `public-sanitized-${options.key}`;
      const sanitizedFullKey = `${bucket}/${exifStrippedKey}`;
      // In mock, store sanitized buffer
      const sanitizedBuf = Buffer.from(`SANITIZED_EXIF_${buf.toString('binary')}`, 'binary');
      this.files.set(sanitizedFullKey, { content: sanitizedBuf, contentType: options.contentType });
    }

    return {
      key: options.key,
      bucket,
      sha256: actualSha256,
      size: buf.length,
      publicUrl: this.getPublicUrl(options.key, bucket),
      exifStrippedKey,
    };
  }

  async get(
    key: string,
    bucket?: string,
  ): Promise<{ content: Buffer; contentType: string } | null> {
    const b = bucket || this.defaultBucket;
    return this.files.get(`${b}/${key}`) || null;
  }

  async delete(key: string, bucket?: string): Promise<boolean> {
    const b = bucket || this.defaultBucket;
    return this.files.delete(`${b}/${key}`);
  }

  getPublicUrl(key: string, bucket?: string): string {
    const b = bucket || this.defaultBucket;
    return `https://storage.marketpulse.local/${b}/${key}`;
  }
}

// --- 4. IPFS Pinner Interface & Pinata Mock ---

export interface PinResult {
  ipfsHash: string; // CID
  pinSize: number;
  timestamp: string;
}

export interface IpfsPinner {
  pinContent(content: Buffer | Uint8Array, name?: string): Promise<PinResult>;
  pinByHash(hash: string, name?: string): Promise<PinResult>;
  isPinned(ipfsHash: string): Promise<boolean>;
}

export class MockIpfsPinner implements IpfsPinner {
  public pinned = new Map<string, { size: number; name?: string; timestamp: string }>();

  async pinContent(content: Buffer | Uint8Array, name?: string): Promise<PinResult> {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
    const hash = crypto.createHash('sha256').update(buf).digest('hex');
    const ipfsHash = `Qm${hash.slice(0, 44)}`;
    const timestamp = new Date().toISOString();

    this.pinned.set(ipfsHash, { size: buf.length, name, timestamp });
    return {
      ipfsHash,
      pinSize: buf.length,
      timestamp,
    };
  }

  async pinByHash(hash: string, name?: string): Promise<PinResult> {
    const ipfsHash =
      hash.startsWith('Qm') || hash.startsWith('bafy') ? hash : `Qm${hash.slice(0, 44)}`;
    const timestamp = new Date().toISOString();
    this.pinned.set(ipfsHash, { size: 1024, name, timestamp });
    return {
      ipfsHash,
      pinSize: 1024,
      timestamp,
    };
  }

  async isPinned(ipfsHash: string): Promise<boolean> {
    return this.pinned.has(ipfsHash);
  }
}

// --- 5. Billing Interface & Paystack/Flutterwave Mock ---

export interface InitializePaymentParams {
  email: string;
  amountMinorUnit: number; // e.g. kobo (NGN 10,000 = 1,000,000 kobo)
  currency: string;
  metadata?: Record<string, unknown>;
  callbackUrl?: string;
}

export interface PaymentInitResult {
  authorizationUrl: string;
  reference: string;
  accessCode: string;
}

export interface PaymentVerifyResult {
  status: 'success' | 'failed' | 'abandoned';
  reference: string;
  amount: number;
  currency: string;
  gatewayResponse: string;
  paidAt?: string;
}

export interface Billing {
  initializePayment(params: InitializePaymentParams): Promise<PaymentInitResult>;
  verifyPayment(reference: string): Promise<PaymentVerifyResult>;
  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean;
}

export class MockBilling implements Billing {
  public webhookSecret = 'mock_billing_secret_key_1234567890';
  public transactions = new Map<
    string,
    { params: InitializePaymentParams; status: 'success' | 'failed' }
  >();

  async initializePayment(params: InitializePaymentParams): Promise<PaymentInitResult> {
    const reference = `MP_TX_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    this.transactions.set(reference, { params, status: 'success' });

    return {
      authorizationUrl: `https://checkout.mockbilling.local/pay/${reference}`,
      reference,
      accessCode: `ACC_${crypto.randomBytes(6).toString('hex')}`,
    };
  }

  async verifyPayment(reference: string): Promise<PaymentVerifyResult> {
    const tx = this.transactions.get(reference);
    if (!tx) {
      return {
        status: 'failed',
        reference,
        amount: 0,
        currency: 'NGN',
        gatewayResponse: 'Transaction reference not found',
      };
    }

    return {
      status: tx.status,
      reference,
      amount: tx.params.amountMinorUnit,
      currency: tx.params.currency,
      gatewayResponse: 'Approved',
      paidAt: new Date().toISOString(),
    };
  }

  verifyWebhookSignature(payload: string | Buffer, signature: string): boolean {
    const raw = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
    const expected = crypto.createHmac('sha512', this.webhookSecret).update(raw).digest('hex');
    return expected.toLowerCase() === signature.toLowerCase();
  }
}

// --- Service Factory ---

export interface ServiceContainer {
  sms: SmsProvider;
  relayer: Relayer;
  storage: ObjectStorage;
  ipfs: IpfsPinner;
  billing: Billing;
}

export function createServiceContainer(
  overrides: Partial<ServiceContainer> = {},
): ServiceContainer {
  return {
    sms: overrides.sms || new MockSmsProvider(),
    relayer: overrides.relayer || new MockRelayer(),
    storage: overrides.storage || new MockObjectStorage(),
    ipfs: overrides.ipfs || new MockIpfsPinner(),
    billing: overrides.billing || new MockBilling(),
  };
}
