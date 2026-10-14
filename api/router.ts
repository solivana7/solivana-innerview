import { createRouter, publicQuery } from "./middleware";
import { analyzeRouter } from "./analyze";
import { accessRouter } from "./access";
import { authRouter } from "./auth";
import { adminRouter } from "./admin";

export const appRouter = createRouter({
  ping: publicQuery.query(() => ({ ok: true, ts: Date.now() })),
  analyze: analyzeRouter,
  access: accessRouter,
  auth: authRouter,
  admin: adminRouter,
});

export type AppRouter = typeof appRouter;
