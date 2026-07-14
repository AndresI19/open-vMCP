import { Router } from 'express';
import { callsRouter } from './calls.js';
import { serversRouter } from './servers.js';
import { statsRouter } from './stats.js';
import { toolsRouter } from './tools.js';
import { usersRouter } from './users.js';

/** Dashboard data API. Open (operator view) — the MCP endpoints are what require auth. */
export const apiRouter = Router();

apiRouter.use('/stats', statsRouter);
apiRouter.use('/tools', toolsRouter);
apiRouter.use('/servers', serversRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/calls', callsRouter);
