#!/usr/bin/env node
import { startMcpServer } from './server.js';

const args = process.argv.slice(2);
const valueOf = (name: string): string | undefined => {
  const index = args.indexOf(`--${name}`);
  if (index !== -1 && args[index + 1]) return args[index + 1];
  const inline = args.find((arg) => arg.startsWith(`--${name}=`));
  return inline?.slice(name.length + 3);
};

await startMcpServer({
  apiUrl: valueOf('api'),
  projectRoot: valueOf('root') ?? process.cwd(),
});
