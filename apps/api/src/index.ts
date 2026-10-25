/**
 * Fastify / Backend API entry placeholder for MarketPulse Oracle.
 */
import { LAUNCH_DATA_TYPES } from '@marketpulse/shared';

export function getApiStatus() {
  return {
    status: 'ok',
    version: '0.1.0',
    dataTypes: Object.keys(LAUNCH_DATA_TYPES),
  };
}
