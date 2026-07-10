import { JOB_STATES, VALID_CONFIG_ALIASES } from './constants.js';

export function parseJobPayload(payload) {
  let parsed;

  try {
    parsed = JSON.parse(payload);
  } catch {
    throw new Error('Invalid JSON payload');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Job payload must be a JSON object');
  }

  if (parsed.id !== undefined && (typeof parsed.id !== 'string' || parsed.id.trim() === '')) {
    throw new Error('Job id must be a non-empty string');
  }

  if (typeof parsed.command !== 'string' || parsed.command.trim() === '') {
    throw new Error('Job command must be a non-empty string');
  }

  return parsed;
}

export function normalizeState(state) {
  if (!state) {
    return undefined;
  }

  const normalized = String(state).toLowerCase();
  if (!Object.values(JOB_STATES).includes(normalized)) {
    throw new Error(`Invalid state "${state}"`);
  }

  return normalized;
}

export function normalizeConfigKey(key) {
  const normalized = VALID_CONFIG_ALIASES[key];
  if (!normalized) {
    throw new Error(`Unknown config key "${key}"`);
  }

  return normalized;
}

export function assertNonNegativeInteger(value, label) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }

  return numericValue;
}

export function assertPositiveInteger(value, label) {
  const numericValue = Number(value);
  if (!Number.isInteger(numericValue) || numericValue <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }

  return numericValue;
}
