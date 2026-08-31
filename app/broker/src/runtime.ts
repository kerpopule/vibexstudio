import { createPrivateKey } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { JsonFileBrokerStore, PrivateModelBroker, type BrokerConfig } from './core.ts';

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

export async function loadBrokerFromEnvironment(): Promise<PrivateModelBroker> {
  const signingPem = await readFile(required('VIBEX_PROFILE_SIGNING_KEY_FILE'), 'utf8');
  const config: BrokerConfig = {
    publicApiBaseUrl: process.env.VIBEX_PUBLIC_API_BASE_URL ?? 'https://api.vibexstudio.com/v1',
    upstreamBaseUrl: required('VIBEX_UPSTREAM_BASE_URL'),
    upstreamBearer: required('VIBEX_UPSTREAM_BEARER'),
    tokenHashKey: required('VIBEX_TOKEN_HASH_KEY'),
    profileSigningKey: createPrivateKey(signingPem),
    signingKeyId: required('VIBEX_PROFILE_SIGNING_KEY_ID'),
    issuer: process.env.VIBEX_ISSUER ?? 'Steve',
    allowedModels: (process.env.VIBEX_ALLOWED_MODELS ?? 'deepseek-v4-flash')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    limits: {
      perMinute: 4,
      perDevicePerDay: 20,
      perGrantPerDay: 60,
      perDeviceConcurrent: 1,
      globalConcurrent: 2,
      maxOutputTokens: 4096,
    },
    logger: (event) => process.stdout.write(`${JSON.stringify(event)}\n`),
  };
  return new PrivateModelBroker(
    new JsonFileBrokerStore(process.env.VIBEX_STORE_PATH ?? './broker/local-state/broker.json'),
    config
  );
}
