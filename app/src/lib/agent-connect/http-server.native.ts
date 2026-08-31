import TcpSocket from 'react-native-tcp-socket';
import type Server from 'react-native-tcp-socket/lib/types/Server';
import type Socket from 'react-native-tcp-socket/lib/types/Socket';

import {
  MAX_REQUEST_BODY_BYTES,
  type ConnectHttpRequest,
  type ConnectHttpResponse,
} from '@/lib/agent-connect/core';

const MAX_HEADER_BYTES = 64 * 1024;
const STATUS_TEXT: Record<number, string> = {
  200: 'OK',
  202: 'Accepted',
  400: 'Bad Request',
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
  405: 'Method Not Allowed',
  410: 'Gone',
  413: 'Payload Too Large',
  429: 'Too Many Requests',
  500: 'Internal Server Error',
};

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function indexAfterUtf8Bytes(value: string, start: number, byteCount: number): number | null {
  let bytes = 0;
  let index = start;
  while (index < value.length && bytes < byteCount) {
    const codePoint = value.codePointAt(index)!;
    index += codePoint > 0xffff ? 2 : 1;
    bytes += codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;
  }
  return bytes === byteCount ? index : null;
}

function send(socket: Socket, response: ConnectHttpResponse): void {
  const body = response.body ?? '';
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...response.headers,
  };
  const lines = [
    `HTTP/1.1 ${response.status} ${STATUS_TEXT[response.status] ?? ''}`,
    `Content-Length: ${byteLength(body)}`,
    'Connection: close',
    ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
    '',
    body,
  ];
  try {
    socket.write(lines.join('\r\n'), 'utf8', () => socket.destroy());
  } catch {
    socket.destroy();
  }
}

export interface LocalHttpServer {
  close(): void;
}

export async function startLocalHttpServer(
  port: number,
  handler: (request: ConnectHttpRequest) => Promise<ConnectHttpResponse>,
): Promise<LocalHttpServer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const server: Server = TcpSocket.createServer((socket) => {
      socket.setEncoding('utf8');
      socket.setTimeout(30_000, () => socket.destroy());
      let buffer = '';
      let handled = false;

      socket.on('data', (chunk) => {
        if (handled) return;
        buffer += typeof chunk === 'string' ? chunk : chunk.toString('utf8');
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) {
          if (byteLength(buffer) > MAX_HEADER_BYTES) {
            handled = true;
            send(socket, { status: 400, body: JSON.stringify({ error: 'headers too large' }) });
          }
          return;
        }
        if (byteLength(buffer.slice(0, headerEnd)) > MAX_HEADER_BYTES) {
          handled = true;
          send(socket, { status: 400, body: JSON.stringify({ error: 'headers too large' }) });
          return;
        }

        const headerText = buffer.slice(0, headerEnd);
        const [requestLine = '', ...headerLines] = headerText.split('\r\n');
        const [method = '', rawPath = ''] = requestLine.split(' ');
        const headers: Record<string, string> = {};
        let invalidHeaders = false;
        for (const line of headerLines) {
          const separator = line.indexOf(':');
          if (separator <= 0) {
            invalidHeaders = true;
            break;
          }
          const name = line.slice(0, separator).trim().toLowerCase();
          if (!name || headers[name] !== undefined) {
            invalidHeaders = true;
            break;
          }
          headers[name] = line.slice(separator + 1).trim();
        }
        if (invalidHeaders || headers['transfer-encoding'] !== undefined) {
          handled = true;
          send(socket, { status: 400, body: JSON.stringify({ error: 'invalid or unsupported headers' }) });
          return;
        }
        const rawLength = headers['content-length'];
        if (rawLength !== undefined && !/^\d+$/.test(rawLength)) {
          handled = true;
          send(socket, { status: 400, body: JSON.stringify({ error: 'invalid content-length' }) });
          return;
        }
        const contentLength = rawLength === undefined ? 0 : Number(rawLength);
        if (contentLength > MAX_REQUEST_BODY_BYTES) {
          handled = true;
          send(socket, { status: 413, body: JSON.stringify({ error: 'request body too large' }) });
          return;
        }
        const bodyStart = headerEnd + 4;
        const bodyEnd = indexAfterUtf8Bytes(buffer, bodyStart, contentLength);
        if (bodyEnd === null) return;
        handled = true;
        const request: ConnectHttpRequest = {
          method: method.toUpperCase(),
          path: rawPath,
          headers,
          body: buffer.slice(bodyStart, bodyEnd),
          remoteAddress: socket.remoteAddress ?? 'unknown',
        };
        void handler(request)
          .then((response) => send(socket, response))
          .catch(() => send(socket, { status: 500, body: JSON.stringify({ error: 'internal error' }) }));
      });
      socket.on('error', () => socket.destroy());
    });

    server.on('error', (error) => {
      if (!settled) {
        settled = true;
        reject(error);
      }
    });
    server.listen({ port, host: '0.0.0.0', reuseAddress: true }, () => {
      if (settled) return;
      settled = true;
      resolve({ close: () => server.close() });
    });
  });
}
