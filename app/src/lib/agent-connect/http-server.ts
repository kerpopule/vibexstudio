import type { ConnectHttpRequest, ConnectHttpResponse } from '@/lib/agent-connect/core';

export interface LocalHttpServer { close(): void }

export async function startLocalHttpServer(
  _port: number,
  _handler: (request: ConnectHttpRequest) => Promise<ConnectHttpResponse>,
): Promise<LocalHttpServer> {
  throw new Error('The local MCP server requires an installed native iOS or Android build.');
}
