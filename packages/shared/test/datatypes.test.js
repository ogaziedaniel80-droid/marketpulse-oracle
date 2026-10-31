import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  LAUNCH_DATA_TYPES,
  PLANNED_DATA_TYPES,
  DataTypeSpecSchema,
  RequestParamsSchema,
  ReportValueSchema,
} from '../dist/index.js';

describe('Data Types Specifications', () => {
  test('all launch types are enabled and conform to schema', () => {
    const launchCodes = ['RICE50', 'GARRI', 'MAIZE', 'TOMATO', 'FUEL_PMS', 'FUEL_DSL'];

    for (const code of launchCodes) {
      const spec = LAUNCH_DATA_TYPES[code];
      assert.ok(spec, `Launch type ${code} must exist`);
      assert.strictEqual(spec.enabled, true, `${code} must be enabled by default`);
      assert.strictEqual(spec.status, 'active');

      const parsed = DataTypeSpecSchema.safeParse(spec);
      assert.ok(parsed.success, `Schema validation failed for ${code}: ${parsed.error}`);
    }
  });

  test('second-wave planned types are disabled by default', () => {
    const plannedCodes = ['POWER', 'ROAD', 'LPG', 'FX_PARALLEL', 'CHECKPOINT'];

    for (const code of plannedCodes) {
      const spec = PLANNED_DATA_TYPES[code];
      assert.ok(spec, `Planned type ${code} must exist`);
      assert.strictEqual(spec.enabled, false, `${code} must be disabled by default`);
      assert.strictEqual(spec.status, 'planned');

      if (code === 'FX_PARALLEL' || code === 'CHECKPOINT') {
        assert.strictEqual(spec.safetyReviewRequired, true);
        assert.strictEqual(spec.legalReviewRequired, true);
      }

      const parsed = DataTypeSpecSchema.safeParse(spec);
      assert.ok(parsed.success, `Schema validation failed for ${code}: ${parsed.error}`);
    }
  });

  test('RequestParamsSchema validates proper request boundaries', () => {
    const validParams = {
      dataType: 'RICE50',
      geohash: 's14b3k9x',
      bounty: '5000000', // 5 USDC
      token: 'CAS3J7GYCCXGRQ5FSQMGEMISFY7AN6CFUOSVDCSOALW3RZGEZN7IRLQO',
      minStake: '500000', // 0.5 USDC
      toleranceBps: 800,
      commitDeadline: 1700000000,
      revealDeadline: 1700003600,
      challengeWindow: 86400,
      minReports: 5,
      maxReports: 15,
    };

    const parsed = RequestParamsSchema.safeParse(validParams);
    assert.ok(parsed.success, `Valid request params rejected: ${parsed.error}`);

    // Reject bounty below minimum (3 USDC)
    const lowBounty = { ...validParams, bounty: '2000000' };
    assert.strictEqual(RequestParamsSchema.safeParse(lowBounty).success, false);

    // Reject invalid deadline order
    const badDeadlines = { ...validParams, commitDeadline: 2000, revealDeadline: 1000 };
    assert.strictEqual(RequestParamsSchema.safeParse(badDeadlines).success, false);

    // Reject minReports > maxReports
    const badReportCounts = { ...validParams, minReports: 10, maxReports: 5 };
    assert.strictEqual(RequestParamsSchema.safeParse(badReportCounts).success, false);

    // Reject coarse geohash too short or too long
    assert.strictEqual(
      RequestParamsSchema.safeParse({ ...validParams, geohash: 's14' }).success,
      false,
    );
    assert.strictEqual(
      RequestParamsSchema.safeParse({ ...validParams, geohash: 's14b3k9xyz123' }).success,
      false,
    );
  });

  test('ReportValueSchema validates value, salt, and evidence hash', () => {
    const validReport = {
      value: '8500000',
      salt: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      evidenceHash: 'fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210',
    };

    assert.ok(ReportValueSchema.safeParse(validReport).success);

    // Invalid salt length
    assert.strictEqual(
      ReportValueSchema.safeParse({ ...validReport, salt: 'short' }).success,
      false,
    );
  });
});
