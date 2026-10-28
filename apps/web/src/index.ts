/**
 * MarketPulse Oracle PWA: Offline-first reporter flows, buyer portal, and admin panel.
 */
import { LAUNCH_DATA_TYPES } from '@marketpulse/shared';

export * from './i18n.js';
export * from './currency.js';
export * from './wallet.js';
export * from './offline-queue.js';
export * from './reporter-flow.js';
export * from './buyer-dashboard.js';
export * from './admin-panel.js';
export * from './server.js';

export function getAppInfo() {
  return {
    name: 'MarketPulse Web PWA',
    supportedLaunchTypes: Object.keys(LAUNCH_DATA_TYPES),
  };
}
