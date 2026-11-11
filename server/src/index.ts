import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { EventRow } from '@acp-scrum/shared';
import { bus } from './bus';
import { eventsAfter } from './db';
import { config } from './config';
import { registerRoutes } from './routes';

const app = Fastify({ logger: { level: 'info' } });

await app.register(cors, { origin: true });
await app.register(websocket);

app.setErrorHandler((err: Error, _req, reply) => {
  const status = /not found|unknown|no active|must be|invalid|outside|required|already|WIP|上限/i.test(err.message) ? 400 : 500;
  reply.status(status).send({ error: err.message });
});

await registerRoutes(app);

app.get('/ws', { websocket: true }, (socket, req) => {
  const { afterSeq } = req.query as { afterSeq?: string };
  for (const ev of eventsAfter(Number(afterSeq ?? 0), 5000)) {
    socket.send(JSON.stringify(ev));
  }
  const listener = (ev: EventRow) => {
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(ev));
  };
  bus.on('event', listener);
  socket.on('close', () => bus.off('event', listener));
  socket.on('error', () => bus.off('event', listener));
});

app.get('/api/health', async () => ({ ok: true, agent: config.agentCommand }));

try {
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`acp-scrum server on http://${config.host}:${config.port}, agent=${config.agentCommand}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}