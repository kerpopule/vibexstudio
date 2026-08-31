import { loadBrokerFromEnvironment } from './runtime.ts';

const recipientLabel = process.argv.slice(2).join(' ').trim();
if (!recipientLabel) throw new Error('Usage: npm run broker:issue -- "Recipient label"');
const invite = await (await loadBrokerFromEnvironment()).issueInvite({ recipientLabel });
process.stdout.write(`${JSON.stringify(invite, null, 2)}\n`);
