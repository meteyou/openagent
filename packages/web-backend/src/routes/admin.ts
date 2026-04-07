/**
 * Admin convenience routes
 *
 * GET  /api/admin/users                      — list web users (id, username) for dropdowns
 * GET  /api/admin/telegram/users             — list telegram_users with linked web user info
 * PATCH /api/admin/telegram/users/:id/link  — set / clear the user_id FK on a telegram_user
 */

import { Router } from 'express'
import type { Database } from '@openagent/core'
import { jwtMiddleware } from '../auth.js'
import type { AuthenticatedRequest } from '../auth.js'

interface TelegramUserRow {
  id: number
  telegram_id: string
  telegram_username: string | null
  telegram_display_name: string | null
  status: string
  user_id: number | null
  created_at: string
  updated_at: string
}

interface UserRow {
  id: number
  username: string
}

export function createAdminRouter(db: Database): Router {
  const router = Router()

  // All admin routes require a valid JWT with admin role
  router.use(jwtMiddleware)
  router.use((req: AuthenticatedRequest, res, next) => {
    if (req.user?.role !== 'admin') {
      res.status(403).json({ error: 'Admin access required' })
      return
    }
    next()
  })

  /**
   * GET /api/admin/users — list web users for dropdowns
   */
  router.get('/users', (_req, res) => {
    try {
      const rows = db.prepare(
        'SELECT id, username FROM users ORDER BY username'
      ).all() as UserRow[]

      res.json({ users: rows })
    } catch (err) {
      res.status(500).json({ error: `Failed to list users: ${(err as Error).message}` })
    }
  })

  /**
   * GET /api/admin/telegram/users — list all telegram_users with linked web user info
   */
  router.get('/telegram/users', (_req, res) => {
    try {
      const rows = db.prepare(
        `SELECT tu.*, u.username AS linked_username
         FROM telegram_users tu
         LEFT JOIN users u ON tu.user_id = u.id
         ORDER BY
           CASE tu.status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 ELSE 2 END,
           tu.created_at DESC`
      ).all() as (TelegramUserRow & { linked_username: string | null })[]

      const telegramUsers = rows.map(row => ({
        id: row.id,
        telegramId: row.telegram_id,
        telegramUsername: row.telegram_username,
        telegramDisplayName: row.telegram_display_name,
        status: row.status,
        userId: row.user_id,
        linkedUsername: row.linked_username,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }))

      res.json({ telegramUsers })
    } catch (err) {
      res.status(500).json({ error: `Failed to list telegram users: ${(err as Error).message}` })
    }
  })

  /**
   * PATCH /api/admin/telegram/users/:id/link — set (or clear) the user_id FK
   * Body: { userId: number | null }
   */
  router.patch('/telegram/users/:id/link', (req: AuthenticatedRequest, res) => {
    const rawId = req.params.id
    const id = parseInt(Array.isArray(rawId) ? rawId[0] : rawId, 10)
    if (isNaN(id)) {
      res.status(400).json({ error: 'Invalid telegram user ID' })
      return
    }

    const existing = db.prepare(
      'SELECT * FROM telegram_users WHERE id = ?'
    ).get(id) as TelegramUserRow | undefined

    if (!existing) {
      res.status(404).json({ error: 'Telegram user not found' })
      return
    }

    const { userId } = req.body as { userId: number | null }

    if (userId !== null && userId !== undefined) {
      const webUser = db.prepare('SELECT id FROM users WHERE id = ?').get(userId) as UserRow | undefined
      if (!webUser) {
        res.status(400).json({ error: 'Web user not found' })
        return
      }
    }

    try {
      // Clear previous link from the old web user (if any)
      if (existing.user_id !== null && existing.user_id !== userId) {
        db.prepare(
          "UPDATE users SET telegram_id = NULL, updated_at = datetime('now') WHERE id = ?"
        ).run(existing.user_id)
      }

      // Update telegram_users.user_id
      db.prepare(
        "UPDATE telegram_users SET user_id = ?, updated_at = datetime('now') WHERE id = ?"
      ).run(userId ?? null, id)

      // Keep users.telegram_id in sync
      if (userId !== null && userId !== undefined) {
        // Clear any other user that previously claimed this telegram_id
        db.prepare(
          "UPDATE users SET telegram_id = NULL, updated_at = datetime('now') WHERE telegram_id = ?"
        ).run(existing.telegram_id)
        // Set the new link
        db.prepare(
          "UPDATE users SET telegram_id = ?, updated_at = datetime('now') WHERE id = ?"
        ).run(existing.telegram_id, userId)
      } else {
        // Unlinking: clear telegram_id from the web user
        db.prepare(
          "UPDATE users SET telegram_id = NULL, updated_at = datetime('now') WHERE telegram_id = ?"
        ).run(existing.telegram_id)
      }

      const updated = db.prepare(
        `SELECT tu.*, u.username AS linked_username
         FROM telegram_users tu
         LEFT JOIN users u ON tu.user_id = u.id
         WHERE tu.id = ?`
      ).get(id) as (TelegramUserRow & { linked_username: string | null }) | undefined

      if (!updated) {
        res.status(500).json({ error: 'Failed to retrieve updated record' })
        return
      }

      res.json({
        telegramUser: {
          id: updated.id,
          telegramId: updated.telegram_id,
          telegramUsername: updated.telegram_username,
          telegramDisplayName: updated.telegram_display_name,
          status: updated.status,
          userId: updated.user_id,
          linkedUsername: updated.linked_username,
          createdAt: updated.created_at,
          updatedAt: updated.updated_at,
        },
      })
    } catch (err) {
      res.status(500).json({ error: `Failed to update link: ${(err as Error).message}` })
    }
  })

  return router
}
