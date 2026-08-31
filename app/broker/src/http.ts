import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import {
  MAX_BODY_BYTES,
  PrivateModelBroker,
  BrokerError,
  errorResponse,
  type DeviceAuth,
  type RedeemRequest,
} from './core.ts';

function authFrom(request: IncomingMessage): DeviceAuth {
  const authorization = request.headers.authorization ?? '';
  const match = authorization.match(/^Bearer ([A-Za-z0-9_-]+)$/);
  const deviceProof = request.headers['x-vibex-device-proof'];
  if (!match || typeof deviceProof !== 'string') {
    throw new BrokerError(401, 'missing_credentials', 'Device credentials are required.');
  }
  return { credential: match[1], deviceProof };
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  if (!(request.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) {
    throw new BrokerError(415, 'json_required', 'Content-Type must be application/json.');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new BrokerError(413, 'body_too_large', 'JSON body exceeds 1 MiB.');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new BrokerError(400, 'invalid_json', 'Request body is not valid JSON.');
  }
}

function writeResponse(response: ServerResponse, webResponse: Response): Promise<void> {
  response.statusCode = webResponse.status;
  webResponse.headers.forEach((value, key) => response.setHeader(key, value));
  if (!webResponse.body) {
    response.end();
    return Promise.resolve();
  }
  const reader = webResponse.body.getReader();
  return new Promise((resolve, reject) => {
    response.on('close', () => reader.cancel('client disconnected').catch(() => {}));
    const pump = async () => {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          if (!response.write(Buffer.from(chunk.value))) await new Promise<void>((ready) => response.once('drain', ready));
        }
        response.end();
        resolve();
      } catch (error) {
        response.destroy(error as Error);
        reject(error);
      }
    };
    void pump();
  });
}

export function createBrokerServer(broker: PrivateModelBroker) {
  return createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const url = new URL(request.url ?? '/', 'https://broker.invalid');
    try {
      if (url.search) throw new BrokerError(400, 'query_not_allowed', 'Query parameters are not supported.');
      if (request.method === 'POST' && url.pathname === '/v1/private-model-invites/redeem') {
        const result = await broker.redeem(await readJson(request) as RedeemRequest);
        await writeResponse(response, Response.json(result, { headers: { 'Cache-Control': 'no-store' } }));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/private-model-devices/refresh') {
        const body = await readJson(request) as { refresh_handle?: string; device_proof?: string };
        const result = await broker.refresh(String(body.refresh_handle ?? ''), String(body.device_proof ?? ''));
        await writeResponse(response, Response.json(result, { headers: { 'Cache-Control': 'no-store' } }));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/private-model-devices/revoke') {
        await broker.revoke(authFrom(request));
        await writeResponse(response, new Response(null, { status: 204, headers: { 'Cache-Control': 'no-store' } }));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/v1/models') {
        await writeResponse(response, Response.json(await broker.models(authFrom(request)), { headers: { 'Cache-Control': 'no-store' } }));
        return;
      }
      if (request.method === 'POST' && url.pathname === '/v1/chat/completions') {
        const aborter = new AbortController();
        request.on('aborted', () => aborter.abort());
        await writeResponse(response, await broker.chat(authFrom(request), await readJson(request), aborter.signal));
        return;
      }
      await writeResponse(response, errorResponse(new BrokerError(404, 'route_not_found', 'Route not found.')));
    } catch (error) {
      if (!response.headersSent) await writeResponse(response, errorResponse(error));
      else response.destroy();
    }
  });
}
