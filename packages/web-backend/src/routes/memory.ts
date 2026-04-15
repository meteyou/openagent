import type { AgentCore, Database } from '@openagent/core'
import type { Router } from 'express'
import type { MemoryConsolidationScheduler } from '../memory-consolidation-scheduler.js'
import {
  createMemoryRouter as createMemoryModuleRouter,
  type MemoryRouterOptions,
} from '../api/modules/memory/route.js'

export type { MemoryRouterOptions } from '../api/modules/memory/route.js'

export function createMemoryRouter(
  db: Database,
  getAgentCore: () => AgentCore | null = () => null,
  consolidationScheduler?: MemoryConsolidationScheduler | null,
): Router {
  return createMemoryModuleRouter({
    db,
    getAgentCore,
    consolidationScheduler: consolidationScheduler ?? null,
  } satisfies MemoryRouterOptions)
}
