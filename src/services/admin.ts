import type { Env } from '../env';
import { createQuiz } from './games';

export function isAdmin(env: Env, telegramId: number): boolean {
  return env.ADMIN_TELEGRAM_IDS.split(',').map((value) => value.trim()).filter(Boolean).includes(String(telegramId));
}

export async function addPoints(env: Env, telegramId: number, points: number): Promise<boolean> {
  const user = await env.DB.prepare('SELECT id FROM users WHERE telegram_id = ?').bind(telegramId).first<{ id: number }>();
  if (!user || !Number.isInteger(points) || points === 0) return false;
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare('UPDATE balances SET game_balance = game_balance + ?, total_points = total_points + ?, updated_at = ? WHERE user_id = ?').bind(points, points, now, user.id).run();
  return true;
}

export async function addQuiz(env: Env, definition: string): Promise<boolean> {
  const parts = definition.split('|').map((value) => value.trim());
  if (parts.length < 5) return false;
  const [question, ...rest] = parts;
  const reward = Number(rest.pop());
  const correctOption = Number(rest.pop());
  if (!question || rest.length < 2 || !Number.isInteger(reward) || reward <= 0 || !Number.isInteger(correctOption) || correctOption < 0 || correctOption >= rest.length) return false;
  await createQuiz(env, question, rest, correctOption, reward);
  return true;
}
