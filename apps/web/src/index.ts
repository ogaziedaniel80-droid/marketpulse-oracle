/**
 * Web PWA entry placeholder for MarketPulse Oracle.
 */
import { LAUNCH_DATA_TYPES } from '@marketpulse/shared';

export function getAppInfo() {
  return {
    name: 'MarketPulse Web PWA',
    supportedLaunchTypes: Object.keys(LAUNCH_DATA_TYPES),
  };
}
