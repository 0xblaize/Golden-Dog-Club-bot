import type { Env } from '../env';

const WINDOW_SECONDS = 60;
const MAX_EVENTS = 30;

export async function allowActivity(env: Env, userId: number, eventType: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const windowStart = now - WINDOW_SECONDS;
  const recent = await env.DB.prepare(
    'SELECT COUNT(*) AS count FROM activity_events WHERE user_id = ? AND created_at >= ?'
  ).bind(userId, windowStart).first<{ count: number }>();

  if ((recent?.count ?? 0) >= MAX_EVENTS) return false;

  await env.DB.prepare(
    'INSERT INTO activity_events (user_id, event_type, created_at) VALUES (?, ?, ?)'
  ).bind(userId, eventType, now).run();
  return true;
}

export async function cleanupActivity(env: Env): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('DELETE FROM activity_events WHERE created_at < ?').bind(now - 86400 * 7).run();
  // Unanswered challenges expire after an hour so stale Accept buttons in
  // group chats stop resolving days later.
  await env.DB.prepare(
    "UPDATE battles SET status = 'expired', resolved_at = ? WHERE status = 'pending' AND created_at < ?"
  ).bind(now, now - 3600).run();
}
