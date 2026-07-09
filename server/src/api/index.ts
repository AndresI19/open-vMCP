import { Router } from "express";
import { statsRouter } from "./stats.js";
import { serversRouter } from "./servers.js";
import { usersRouter } from "./users.js";
import { callsRouter } from "./calls.js";
import { toolsRouter } from "./tools.js";

/** Dashboard data API. Open (operator view) — the MCP endpoints are what require auth. */
export const apiRouter = Router();

apiRouter.use("/stats", statsRouter);
apiRouter.use("/tools", toolsRouter);
apiRouter.use("/servers", serversRouter);
apiRouter.use("/users", usersRouter);
apiRouter.use("/calls", callsRouter);
