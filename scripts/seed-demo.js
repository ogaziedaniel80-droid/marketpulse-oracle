#!/usr/bin/env node
/**
 * Demo seed script per README Section 14.7.
 * Seeds 5 demo reporters, 3 pilot markets (Wuse, Garki, Utako), a sample RICE50 request,
 * and mock evidence blobs with verified SHA-256 hashes.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServiceContainer, LAUNCH_DATA_TYPES } from '../packages/shared/dist/index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

async function seedDemo() {
  console.log('=== MarketPulse Oracle: Seeding Demo Environment ===');
  const services = createServiceContainer();

  // 1. Pilot Markets (Abuja, Nigeria)
  const markets = [
    { id: 'mkt_wuse', name: 'Wuse Market', city: 'Abuja', country: 'NG', geohash: 's14702' },
    {
      id: 'mkt_garki',
      name: 'Garki Model Market',
      city: 'Abuja',
      country: 'NG',
      geohash: 's146cr',
    },
    {
      id: 'mkt_utako',
      name: 'Utako Ultra Modern Market',
      city: 'Abuja',
      country: 'NG',
      geohash: 's14700',
    },
  ];

  // 2. Demo Reporters (No personal data on-chain; phone numbers salted & hashed)
  const rawReporters = [
    {
      label: 'Alhaji Musa (Honest #1)',
      phone: '+2348030000001',
      tier: 2,
      reputationBps: 8500,
      role: 'honest',
      priceNgn: 82000,
    },
    {
      label: 'Chioma Okeke (Honest #2)',
      phone: '+2348030000002',
      tier: 2,
      reputationBps: 8200,
      role: 'honest',
      priceNgn: 81500,
    },
    {
      label: 'Ibrahim Haruna (Honest #3)',
      phone: '+2348030000003',
      tier: 1,
      reputationBps: 7800,
      role: 'honest',
      priceNgn: 82500,
    },
    {
      label: 'Blessing Eze (Outlier)',
      phone: '+2348030000004',
      tier: 1,
      reputationBps: 6000,
      role: 'outlier',
      priceNgn: 140000,
    },
    {
      label: 'Emeka Nwachukwu (Non-Revealer)',
      phone: '+2348030000005',
      tier: 1,
      reputationBps: 5000,
      role: 'non_revealer',
      priceNgn: 0,
    },
  ];

  const reporters = rawReporters.map((r, idx) => {
    const salt = `demo_salt_${idx + 1}`;
    const phoneHash = crypto.createHash('sha256').update(`${r.phone}:${salt}`).digest('hex');
    const walletAddress = `G${phoneHash.toUpperCase().slice(0, 55)}`;
    return {
      id: `rep_demo_${idx + 1}`,
      label: r.label,
      walletAddress,
      phoneHash,
      tier: r.tier,
      reputationBps: r.reputationBps,
      role: r.role,
      priceNgn: r.priceNgn,
    };
  });

  // 3. Seed Mock Evidence Photos into ObjectStorage
  const evidenceRecords = [];
  for (const rep of reporters.filter((r) => r.role !== 'non_revealer')) {
    const photoBuffer = Buffer.from(
      `JPEG_DEMO_EVIDENCE:${rep.walletAddress}:RICE50:${rep.priceNgn}:WUSE_ABUJA`,
      'utf-8',
    );
    const clientSha256 = crypto.createHash('sha256').update(photoBuffer).digest('hex');
    const stored = await services.storage.upload({
      key: `req_101_${rep.id}.jpg`,
      content: photoBuffer,
      contentType: 'image/jpeg',
      expectedSha256: clientSha256,
      stripExif: true,
    });
    evidenceRecords.push({
      reporterAddress: rep.walletAddress,
      evidenceSha256: stored.sha256,
      rawKey: stored.key,
      strippedPublicKey: stored.exifStrippedKey,
    });
  }

  // 4. Sample Request (RICE50 in Wuse Market)
  const nowSec = Math.floor(Date.now() / 1000);
  const sampleRequest = {
    requestId: '101',
    dataType: LAUNCH_DATA_TYPES.RICE50.code,
    geohash: 's14702',
    marketName: 'Wuse Market, Abuja',
    bountyUsdc: '50.00',
    bountyStroops: '500000000',
    minStakeUsdc: '10.00',
    minStakeStroops: '100000000',
    toleranceBps: 800,
    minReports: 3,
    maxReports: 15,
    commitDeadline: nowSec + 3600,
    revealDeadline: nowSec + 7200,
    challengeWindow: 3600,
  };

  const seedArtifact = {
    seededAt: new Date().toISOString(),
    markets,
    reporters,
    sampleRequest,
    evidenceRecords,
  };

  const outDir = path.join(repoRoot, '.turbo');
  fs.mkdirSync(outDir, { recursive: true });
  const seedFile = path.join(outDir, 'demo-seed.json');
  fs.writeFileSync(seedFile, JSON.stringify(seedArtifact, null, 2));

  console.log(`Seeded ${markets.length} pilot markets: ${markets.map((m) => m.name).join(', ')}`);
  console.log(`Seeded ${reporters.length} demo reporters (3 honest, 1 outlier, 1 non-revealer)`);
  console.log(
    `Seeded ${evidenceRecords.length} EXIF-stripped evidence objects in MockObjectStorage`,
  );
  console.log(
    `Seeded sample request #${sampleRequest.requestId} (${sampleRequest.dataType} @ ${sampleRequest.geohash})`,
  );
  console.log('Demo seed completed successfully.');
}

seedDemo().catch((err) => {
  console.error('Demo seed failed:', err);
  process.exit(1);
});
