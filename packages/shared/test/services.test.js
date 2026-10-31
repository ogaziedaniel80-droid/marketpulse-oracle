import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  MockSmsProvider,
  MockRelayer,
  MockObjectStorage,
  MockIpfsPinner,
  MockBilling,
  EvidenceHashMismatchError,
  createServiceContainer,
} from '../dist/index.js';

describe('External Service Interfaces & Local Mocks', () => {
  describe("MockSmsProvider (Africa's Talking Mock)", () => {
    test('sends SMS and extracts 6-digit OTP', async () => {
      const sms = new MockSmsProvider();
      const res = await sms.sendSms({
        to: '+2348012345678',
        message: 'Your MarketPulse verification code is 849201. Valid for 10 minutes.',
      });

      assert.equal(res.success, true);
      assert.ok(res.messageId.startsWith('AT_MSG_'));
      assert.equal(res.recipient, '+2348012345678');

      const otp = sms.getLastOtp('+2348012345678');
      assert.equal(otp, '849201');

      const isDelivered = await sms.verifyDelivery(res.messageId);
      assert.equal(isDelivered, true);
    });

    test('returns null when no OTP exists for phone', async () => {
      const sms = new MockSmsProvider();
      assert.equal(sms.getLastOtp('+2340000000000'), null);
    });
  });

  describe('MockRelayer (Fee-Sponsorship Relayer Mock)', () => {
    test('sponsors fees, tracks balances and envelopes transaction', async () => {
      const relayer = new MockRelayer();
      const initialBalance = await relayer.getBalance();
      assert.equal(initialBalance.balanceUsdc, '500.00');
      assert.equal(initialBalance.balanceXlm, '1000.00');

      const fakeXdr = 'AAAAAG1vY2tfdHJhbnNhY3Rpb25feGRy';
      const result = await relayer.relay({ transactionXdr: fakeXdr });

      assert.equal(result.success, true);
      assert.ok(result.hash.length === 64);
      assert.ok(result.envelopeXdr.startsWith('FEE_BUMP_'));

      const postBalance = await relayer.getBalance();
      assert.ok(parseFloat(postBalance.balanceXlm) < 1000.0);

      const sim = await relayer.simulate(fakeXdr);
      assert.equal(sim.success, true);
      assert.equal(sim.minResourceFee, '10000');
    });

    test('handles failure simulation when flag set', async () => {
      const relayer = new MockRelayer();
      relayer.failNext = true;
      await assert.rejects(
        () => relayer.relay({ transactionXdr: 'test' }),
        /Insufficient fee sponsorship budget/,
      );
    });
  });

  describe('MockObjectStorage (S3/MinIO & EXIF Stripping Mock)', () => {
    test('verifies client SHA-256 and creates EXIF-stripped public copy', async () => {
      const storage = new MockObjectStorage();
      const content = Buffer.from('FAKE_JPEG_IMAGE_WITH_EXIF_DATA');
      const expectedSha256 = crypto.createHash('sha256').update(content).digest('hex');

      const result = await storage.upload({
        key: 'evidence/task-101/photo.jpg',
        content,
        contentType: 'image/jpeg',
        expectedSha256,
        stripExif: true,
      });

      assert.equal(result.sha256, expectedSha256);
      assert.equal(result.exifStrippedKey, 'public-sanitized-evidence/task-101/photo.jpg');

      const retrieved = await storage.get(result.key);
      assert.ok(retrieved);
      assert.equal(retrieved.content.toString(), content.toString());

      const sanitized = await storage.get(result.exifStrippedKey);
      assert.ok(sanitized);
      assert.ok(sanitized.content.toString().includes('SANITIZED_EXIF'));
    });

    test('rejects upload when client SHA-256 does not match content', async () => {
      const storage = new MockObjectStorage();
      const content = Buffer.from('REAL_CONTENT');
      const wrongSha256 = '0000000000000000000000000000000000000000000000000000000000000000';

      await assert.rejects(
        () =>
          storage.upload({
            key: 'evidence/fake.jpg',
            content,
            contentType: 'image/jpeg',
            expectedSha256: wrongSha256,
          }),
        EvidenceHashMismatchError,
      );
    });
  });

  describe('MockIpfsPinner (Pinata Mock)', () => {
    test('pins content and retrieves CID', async () => {
      const ipfs = new MockIpfsPinner();
      const content = Buffer.from('EVIDENCE_METADATA_JSON');
      const res = await ipfs.pinContent(content, 'evidence-101');

      assert.ok(res.ipfsHash.startsWith('Qm'));
      assert.equal(await ipfs.isPinned(res.ipfsHash), true);
      assert.equal(await ipfs.isPinned('QmNonExistent'), false);
    });
  });

  describe('MockBilling (Paystack/Flutterwave Mock)', () => {
    test('initializes and verifies payment', async () => {
      const billing = new MockBilling();
      const init = await billing.initializePayment({
        email: 'buyer@example.com',
        amountMinorUnit: 500000, // NGN 5,000.00
        currency: 'NGN',
      });

      assert.ok(init.reference.startsWith('MP_TX_'));
      assert.ok(init.authorizationUrl.includes(init.reference));

      const verify = await billing.verifyPayment(init.reference);
      assert.equal(verify.status, 'success');
      assert.equal(verify.amount, 500000);
      assert.equal(verify.currency, 'NGN');
    });

    test('validates webhook HMAC signature', async () => {
      const billing = new MockBilling();
      const payload = JSON.stringify({ event: 'charge.success', data: { id: 12345 } });
      const validSig = crypto
        .createHmac('sha512', billing.webhookSecret)
        .update(payload)
        .digest('hex');

      assert.equal(billing.verifyWebhookSignature(payload, validSig), true);
      assert.equal(billing.verifyWebhookSignature(payload, 'wrong_signature'), false);
    });
  });

  describe('createServiceContainer', () => {
    test('instantiates complete container with default mocks', () => {
      const container = createServiceContainer();
      assert.ok(container.sms instanceof MockSmsProvider);
      assert.ok(container.relayer instanceof MockRelayer);
      assert.ok(container.storage instanceof MockObjectStorage);
      assert.ok(container.ipfs instanceof MockIpfsPinner);
      assert.ok(container.billing instanceof MockBilling);
    });
  });
});
