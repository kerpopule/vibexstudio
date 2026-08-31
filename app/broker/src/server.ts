import { loadBrokerFromEnvironment } from './runtime.ts';
import { createBrokerServer } from './http.ts';

const port = Number(process.env.PORT ?? 8787);
const server = createBrokerServer(await loadBrokerFromEnvironment());
server.listen(port, '127.0.0.1', () => {
  process.stdout.write(`VibeX private broker listening on 127.0.0.1:${port}\n`);
});
