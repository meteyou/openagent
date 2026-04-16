# Final Architecture Conventions (PRD #10)

Diese Konventionen sind der **finale Zielzustand** nach der Monorepo-Refaktorierung.

## 1) Package-Boundaries

- `packages/core` ist die stabile, plattformunabhängige Boundary.
- `web-backend`, `web-frontend` und `telegram` konsumieren Core nur über `@openagent/core` (keine `@openagent/core/src/*` Deep-Imports).
- `core` importiert keine Plattformpakete.
- `web-frontend` importiert weder `web-backend` noch `telegram`.
- `telegram` importiert weder `web-backend` noch `web-frontend`.

## 2) Backend-Konvention

Verbindliches Layering für modulare API-Domänen unter `packages/web-backend/src/api/modules/<domain>/`:

```text
route -> controller -> service -> schema/mapper
```

- `app.ts` verwendet für migrierte Domänen ausschließlich die kanonischen Modul-Routen:
  - `api/modules/settings/route.ts`
  - `api/modules/providers/route.ts`
  - `api/modules/memory/route.ts`
  - `api/modules/tasks/route.ts`
- Übergangsadapter unter `src/routes/{settings,providers,memory,tasks}.ts` wurden entfernt.

## 3) Core Deep Modules

- Agent-Laufzeit wird über `createAgentRuntime`/`AgentRuntimeBoundary` gekapselt.
- Task-Laufzeit wird über `createTaskRuntime`/`TaskRuntimeBoundary` gekapselt.
- Integrationen (z. B. Heartbeat, Consolidation Scheduler, Task-Tools) nutzen Boundary-Contracts statt Low-Level-Wiring.

## 4) Frontend-Konvention

- `pages/` orchestrieren nur.
- Feature-Logik lebt in `features/`.
- HTTP/Transport-Logik lebt in `api/`.

## 5) Enforced Rules

Regeln sind über `eslint.boundaries.config.js` abgesichert:

- Package-Boundaries
- Backend-Layer-Boundaries (`route/controller/service/schema|mapper`)
- Frontend-Layer-Boundaries (`pages/features/api`)
- Verbot alter Backend-Adapter-Imports (`routes/settings|providers|memory|tasks`)

## 6) Verification

Für stabile Funktionalität nach Abschluss:

```bash
npm run lint:boundaries
npm run baseline:unit
npm run baseline:api
npm run verify:critical-flows
```

`verify:critical-flows` deckt kritische End-to-End-/Smoke-Flows für Auth, Chat-History, Memory, Settings, Providers, Tasks und Cronjobs ab.
