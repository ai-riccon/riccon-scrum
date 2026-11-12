import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import type { EventRow } from '@riccon-scrum/shared';
import { bus } from './bus';
import { eventsAfter, recentEvents } from './db';
import { config } from './config';
import { registerRoutes } from './routes';
import { manager } from './acp/manager';
import { cleanupDiscoveryState } from './discovery';
import { cleanupIntakeState } from './intake';
import { cleanupSplitState } from './split';
import { cleanupTaxonomyState } from './taxonomy';
import { cleanupDependencySuggestState } from './dependency-suggest';
import { cleanupDocumentState } from './documents';

const app = Fastify({ logger: { level: 'info' } });

await app.register(cors, { origin: true });
await app.register(websocket);

app.setErrorHandler((err: Error, _req, reply) => {
  const status = /not found|unknown|no active|must be|invalid|outside|required|already|WIP|上限|最多|门禁|指令|未知|无效|请提供|请先|需求|草稿|反馈|生成|批准|校验|发布|回滚|契约|分类|标签|已存在|依赖|拆分|子需求|前置|循环|未通过|任务|跳过|规划|变更|Bug|缺陷|分诊|重复/i.test(err.message) ? 400 : 500;
  reply.status(status).send({ error: err.message });
});

await registerRoutes(app);
await cleanupDiscoveryState();
cleanupIntakeState();
cleanupSplitState();
cleanupTaxonomyState();
cleanupDependencySuggestState();
cleanupDocumentState();
manager.startReaper();

app.get('/ws', { websocket: true }, (socket, req) => {
  const { afterSeq } = req.query as { afterSeq?: string };
  const start = Number(afterSeq ?? 0);
  const backlog = start > 0 ? eventsAfter(start, 5000) : recentEvents(1000);
  for (const ev of backlog) {
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
  app.log.info(`riccon-scrum server on http://${config.host}:${config.port}, agent=${config.agentCommand}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}