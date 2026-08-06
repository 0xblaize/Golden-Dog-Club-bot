import { battleWinChance } from './rules';
import type { Env } from '../env';

interface BattleUser {
  id: number;
  telegramId: number;
  displayName: string;
  username: string | null;
  gameBalance: number;
  battleLimit: number;
  tierId: number;
  wins: number;
}

export interface PendingBattle {
  id: number;
  challengerId: number;
  opponentId: number | null;
  wager: number;
  challengerName: string;
}

export interface BattleCreated {
  id: number;
  wager: number;
  challengerName: string;
  opponentName: string | null;
  opponentTelegramId: number | null;
  open: boolean;
}

export interface BattleActionLayout {
  sendPrivateNotification: boolean;
  showAcceptButtonInChallengerReply: boolean;
}

export function getBattleActionLayout(result: Pick<BattleCreated, 'open' | 'opponentTelegramId'>): BattleActionLayout {
  return {
    sendPrivateNotification: result.opponentTelegramId !== null,
    showAcceptButtonInChallengerReply: result.open
  };
}

/**
 * Creates a challenge. When opponentUsername is omitted the battle is left open
 * so anyone in the challenger's skill group (same tier) can take it with /accept.
 */
export async function createBattle(
  env: Env,
  challengerId: number,
  opponentUsername: string | null,
  wager: number,
  chatId: number
): Promise<BattleCreated | { error: string }> {
  if (!Number.isInteger(wager) || wager <= 0) return { error: 'Wager must be a positive whole number of points.' };

  const challenger = await getUser(env, challengerId);
  if (!challenger) return { error: 'Use /start before battling.' };
  if (wager > challenger.gameBalance) return { error: 'You do not have enough game balance for this wager.' };
  if (wager > challenger.battleLimit) return { error: `Your tier limits battles to ${challenger.battleLimit} points.` };

  let opponent: BattleUser | null = null;
  if (opponentUsername) {
    const cleanUsername = opponentUsername.replace(/^@/, '').toLowerCase();
    opponent = await env.DB.prepare(
      `${USER_SELECT} WHERE lower(u.username) = ?`
    ).bind(cleanUsername).first<BattleUser>();

    if (!opponent) return { error: 'That player has not started the bot yet.' };
    if (opponent.id === challenger.id) return { error: 'You cannot battle yourself.' };
    if (wager > opponent.gameBalance) return { error: `${opponent.displayName} does not have enough points for that wager.` };
  }

  const now = Math.floor(Date.now() / 1000);
  const result = await env.DB.prepare(
    `INSERT INTO battles (challenger_id, opponent_id, wager_points, status, created_at, chat_id)
     VALUES (?, ?, ?, 'pending', ?, ?)`
  ).bind(challenger.id, opponent?.id ?? null, wager, now, chatId).run();

  return {
    id: Number(result.meta.last_row_id),
    wager,
    challengerName: challenger.displayName,
    opponentName: opponent?.displayName ?? null,
    opponentTelegramId: opponent?.telegramId ?? null,
    open: opponent === null
  };
}

/**
 * Finds a battle the given player may accept: a direct challenge to them, or an
 * open challenge raised by someone in the same tier. Newest first.
 */
export async function findAcceptableBattle(env: Env, userId: number, battleId?: number): Promise<PendingBattle | null> {
  const user = await getUser(env, userId);
  if (!user) return null;

  const base = `SELECT b.id, b.challenger_id AS challengerId, b.opponent_id AS opponentId,
      b.wager_points AS wager, c.display_name AS challengerName
    FROM battles b
    JOIN users c ON c.id = b.challenger_id
    WHERE b.status = 'pending' AND b.challenger_id != ?
      AND (b.opponent_id = ? OR (b.opponent_id IS NULL AND c.tier_id = ?))`;

  if (battleId) {
    return env.DB.prepare(`${base} AND b.id = ?`)
      .bind(userId, userId, user.tierId, battleId).first<PendingBattle>();
  }
  return env.DB.prepare(`${base} ORDER BY b.created_at DESC LIMIT 1`)
    .bind(userId, userId, user.tierId).first<PendingBattle>();
}

export async function acceptBattle(
  env: Env,
  opponentId: number,
  battleId?: number
): Promise<{ winnerId: number; winnerName: string; loserName: string; wager: number; winChance: number } | { error: string }> {
  const battle = await findAcceptableBattle(env, opponentId, battleId);
  if (!battle) return { error: 'There is no battle waiting for you right now.' };

  const challenger = await getUser(env, battle.challengerId);
  const opponent = await getUser(env, opponentId);
  if (!challenger || !opponent) return { error: 'Both players must use /start before battling.' };
  if (challenger.gameBalance < battle.wager || opponent.gameBalance < battle.wager) {
    return { error: 'The battle was cancelled because a player no longer has enough points.' };
  }

  // Strength earned from past wins tilts the odds; the clamp keeps it winnable.
  const challengerChance = battleWinChance(challenger.wins, opponent.wins);
  const winnerIsChallenger = randomFloat() < challengerChance;
  const winnerId = winnerIsChallenger ? challenger.id : opponent.id;
  const winnerName = winnerIsChallenger ? challenger.displayName : opponent.displayName;
  const loserName = winnerIsChallenger ? opponent.displayName : challenger.displayName;
  const now = Math.floor(Date.now() / 1000);

  // Claiming the row first makes a double-accept a no-op rather than a double payout.
  const claim = await env.DB.prepare(
    "UPDATE battles SET status = 'resolved', winner_id = ?, opponent_id = ?, resolved_at = ? WHERE id = ? AND status = 'pending'"
  ).bind(winnerId, opponent.id, now, battle.id).run();
  if (claim.meta.changes !== 1) return { error: 'That battle was accepted by another request.' };

  await env.DB.batch([
    env.DB.prepare('UPDATE balances SET game_balance = game_balance - ?, total_points = total_points - ?, updated_at = ? WHERE user_id IN (?, ?)')
      .bind(battle.wager, battle.wager, now, challenger.id, opponent.id),
    env.DB.prepare('UPDATE balances SET game_balance = game_balance + ?, total_points = total_points + ?, updated_at = ? WHERE user_id = ?')
      .bind(battle.wager * 2, battle.wager * 2, now, winnerId)
  ]);

  return {
    winnerId,
    winnerName,
    loserName,
    wager: battle.wager,
    winChance: winnerIsChallenger ? challengerChance : 1 - challengerChance
  };
}

export async function getLeaderboards(env: Env): Promise<{ collectors: string[]; battlers: string[] }> {
  const collectors = await env.DB.prepare(
    `SELECT u.display_name AS name, COALESCE(SUM(c.points), 0) AS points FROM users u
     LEFT JOIN collection_claims c ON c.user_id = u.id GROUP BY u.id ORDER BY points DESC LIMIT 10`
  ).all<{ name: string; points: number }>();
  const battlers = await env.DB.prepare(
    `SELECT u.display_name AS name, COUNT(b.id) AS wins FROM users u
     LEFT JOIN battles b ON b.winner_id = u.id GROUP BY u.id ORDER BY wins DESC LIMIT 10`
  ).all<{ name: string; wins: number }>();

  return {
    collectors: collectors.results.map((row, index) => `${medal(index)} ${escapeHtml(row.name)} — ${row.points} pts`),
    battlers: battlers.results.map((row, index) => `${medal(index)} ${escapeHtml(row.name)} — ${row.wins} wins`)
  };
}

// Leaderboard rows are rendered inside HTML-parsed messages.
function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const USER_SELECT = `SELECT u.id, u.telegram_id AS telegramId, u.display_name AS displayName, u.username, u.tier_id AS tierId,
    b.game_balance AS gameBalance, t.battle_limit AS battleLimit,
    (SELECT COUNT(*) FROM battles w WHERE w.winner_id = u.id AND w.status = 'resolved') AS wins
  FROM users u JOIN balances b ON b.user_id = u.id JOIN tiers t ON t.id = u.tier_id`;

async function getUser(env: Env, userId: number): Promise<BattleUser | null> {
  return env.DB.prepare(`${USER_SELECT} WHERE u.id = ?`).bind(userId).first<BattleUser>();
}

function medal(index: number): string {
  return ['🥇', '🥈', '🥉'][index] ?? `${index + 1}.`;
}

function randomFloat(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] / 0x100000000;
}
