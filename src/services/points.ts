import { collectStreak, cooldownRemaining, formatDuration, isCooldownReady, streakMultiplier } from './rules';
import type { Env } from '../env';

const COLLECT_REWARD = 100;
const REFERRAL_REWARD = 250;
// A referral pays out only after the invited player has collected this many
// times, so farming rewards with throwaway accounts takes real effort.
const REFERRAL_QUALIFYING_COLLECTS = 3;

export interface UserRecord {
  id: number;
  telegramId: number;
  displayName: string;
  referralCode: string;
  tierId: number;
}

export interface BalanceRecord {
  gameBalance: number;
  spotBalance: number;
  totalPoints: number;
}

export interface TierRecord {
  id: number;
  name: string;
  minimumPoints: number;
  collectCooldownSeconds: number;
  battleLimit: number;
}

export async function ensureUser(env: Env, telegramId: number, displayName: string, username?: string): Promise<UserRecord> {
  const now = Math.floor(Date.now() / 1000);
  const referralCode = `u${telegramId.toString(36)}`;

  await env.DB.prepare(
    `INSERT INTO users (telegram_id, username, display_name, referral_code, tier_id, created_at, last_active_at)
     VALUES (?, ?, ?, ?, 1, ?, ?)
     ON CONFLICT(telegram_id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name, last_active_at = excluded.last_active_at`
  ).bind(telegramId, username ?? null, displayName, referralCode, now, now).run();

  await env.DB.prepare(
    `INSERT INTO balances (user_id, updated_at) SELECT id, ? FROM users WHERE telegram_id = ? ON CONFLICT(user_id) DO NOTHING`
  ).bind(now, telegramId).run();

  const user = await env.DB.prepare(
    'SELECT id, telegram_id AS telegramId, display_name AS displayName, referral_code AS referralCode, tier_id AS tierId FROM users WHERE telegram_id = ?'
  ).bind(telegramId).first<UserRecord>();

  if (!user) throw new Error('Unable to create user');
  return user;
}

export async function getBalance(env: Env, userId: number): Promise<BalanceRecord> {
  const balance = await env.DB.prepare(
    'SELECT game_balance AS gameBalance, spot_balance AS spotBalance, total_points AS totalPoints FROM balances WHERE user_id = ?'
  ).bind(userId).first<BalanceRecord>();
  return balance ?? { gameBalance: 0, spotBalance: 0, totalPoints: 0 };
}

export async function refreshTier(env: Env, userId: number, totalPoints: number): Promise<TierRecord> {
  const tier = await env.DB.prepare(
    `SELECT id, name, minimum_points AS minimumPoints, collect_cooldown_seconds AS collectCooldownSeconds, battle_limit AS battleLimit
     FROM tiers WHERE minimum_points <= ? ORDER BY minimum_points DESC LIMIT 1`
  ).bind(totalPoints).first<TierRecord>();
  if (!tier) throw new Error('No tier is configured');
  await env.DB.prepare('UPDATE users SET tier_id = ? WHERE id = ?').bind(tier.id, userId).run();
  return tier;
}

export async function collectPoints(env: Env, user: UserRecord): Promise<{ ok: true; points: number; streak: number; balance: BalanceRecord; tier: TierRecord } | { ok: false; remaining: number; tier: TierRecord }> {
  const now = Math.floor(Date.now() / 1000);
  const existingBalance = await getBalance(env, user.id);
  const tier = await refreshTier(env, user.id, existingBalance.totalPoints);
  const lastClaim = await env.DB.prepare(
    'SELECT claimed_at AS claimedAt FROM collection_claims WHERE user_id = ? ORDER BY claimed_at DESC LIMIT 1'
  ).bind(user.id).first<{ claimedAt: number }>();

  if (!isCooldownReady(lastClaim?.claimedAt ?? null, now, tier.collectCooldownSeconds)) {
    return { ok: false, remaining: tier.collectCooldownSeconds - (now - (lastClaim?.claimedAt ?? now)), tier };
  }

  // Streak is computed before this claim is inserted; today still counts once
  // this claim lands, so include it by treating today as claimed.
  const streak = await getCollectStreak(env, user.id, now, true);
  const reward = Math.round(COLLECT_REWARD * streakMultiplier(streak));

  const claim = await env.DB.prepare(
    `INSERT INTO collection_claims (user_id, points, claimed_at)
     SELECT ?, ?, ? WHERE NOT EXISTS (
       SELECT 1 FROM collection_claims WHERE user_id = ? AND claimed_at >= ?
     )`
  ).bind(user.id, reward, now, user.id, now - tier.collectCooldownSeconds).run();

  if (claim.meta.changes !== 1) {
    return { ok: false, remaining: tier.collectCooldownSeconds, tier };
  }

  await env.DB.prepare(
    'UPDATE balances SET game_balance = game_balance + ?, total_points = total_points + ?, updated_at = ? WHERE user_id = ?'
  ).bind(reward, reward, now, user.id).run();

  await maybePayReferral(env, user.id, now);

  const balance = await getBalance(env, user.id);
  const upgradedTier = await refreshTier(env, user.id, balance.totalPoints);
  return { ok: true, points: reward, streak, balance, tier: upgradedTier };
}

export async function getCollectStreak(env: Env, userId: number, now: number, includeToday = false): Promise<number> {
  // 60 days of claims bounds the query while covering any realistic streak.
  const claims = await env.DB.prepare(
    'SELECT claimed_at AS claimedAt FROM collection_claims WHERE user_id = ? AND claimed_at >= ?'
  ).bind(userId, now - 60 * 86400).all<{ claimedAt: number }>();
  const days = claims.results.map((row) => row.claimedAt);
  if (includeToday) days.push(now);
  return collectStreak(days, now);
}

/**
 * Pays the referrer once the invited player has enough collects. Pending
 * referrals are stored with reward_points = 0; the conditional UPDATE makes
 * the payout idempotent under concurrent collects.
 */
async function maybePayReferral(env: Env, referredUserId: number, now: number): Promise<void> {
  const pending = await env.DB.prepare(
    'SELECT id, referrer_id AS referrerId FROM referrals WHERE referred_user_id = ? AND reward_points = 0'
  ).bind(referredUserId).first<{ id: number; referrerId: number }>();
  if (!pending) return;

  const collects = await env.DB.prepare(
    'SELECT COUNT(*) AS total FROM collection_claims WHERE user_id = ?'
  ).bind(referredUserId).first<{ total: number }>();
  if ((collects?.total ?? 0) < REFERRAL_QUALIFYING_COLLECTS) return;

  const payout = await env.DB.prepare(
    'UPDATE referrals SET reward_points = ? WHERE id = ? AND reward_points = 0'
  ).bind(REFERRAL_REWARD, pending.id).run();
  if (payout.meta.changes !== 1) return;

  await env.DB.prepare(
    'UPDATE balances SET game_balance = game_balance + ?, total_points = total_points + ?, updated_at = ? WHERE user_id = ?'
  ).bind(REFERRAL_REWARD, REFERRAL_REWARD, now, pending.referrerId).run();
  const balance = await getBalance(env, pending.referrerId);
  await refreshTier(env, pending.referrerId, balance.totalPoints);
}

export async function applyReferral(env: Env, referredUser: UserRecord, referralCode: string): Promise<boolean> {
  const referrer = await env.DB.prepare('SELECT id FROM users WHERE referral_code = ? AND id != ?').bind(referralCode, referredUser.id).first<{ id: number }>();
  if (!referrer) return false;

  const existing = await env.DB.prepare('SELECT id FROM referrals WHERE referred_user_id = ?').bind(referredUser.id).first<{ id: number }>();
  if (existing) return false;

  const now = Math.floor(Date.now() / 1000);
  // Recorded as pending (reward_points = 0); the payout lands via
  // maybePayReferral once the invited player has collected 3 times.
  await env.DB.prepare(
    'INSERT INTO referrals (referrer_id, referred_user_id, reward_points, created_at) VALUES (?, ?, 0, ?)'
  ).bind(referrer.id, referredUser.id, now).run();
  return true;
}

export function cooldownMessage(seconds: number): string {
  return `You can collect again in ${formatDuration(Math.max(0, seconds))}.`;
}

export interface Profile {
  user: UserRecord;
  balance: BalanceRecord;
  tier: TierRecord;
  cooldownRemaining: number;
  battleWins: number;
  referralCount: number;
  pendingReferrals: number;
  streak: number;
}

export async function getProfile(env: Env, user: UserRecord): Promise<Profile> {
  const now = Math.floor(Date.now() / 1000);
  const balance = await getBalance(env, user.id);
  const tier = await refreshTier(env, user.id, balance.totalPoints);

  const lastClaim = await env.DB.prepare(
    'SELECT claimed_at AS claimedAt FROM collection_claims WHERE user_id = ? ORDER BY claimed_at DESC LIMIT 1'
  ).bind(user.id).first<{ claimedAt: number }>();

  const wins = await env.DB.prepare(
    "SELECT COUNT(*) AS wins FROM battles WHERE winner_id = ? AND status = 'resolved'"
  ).bind(user.id).first<{ wins: number }>();

  const referrals = await env.DB.prepare(
    'SELECT SUM(CASE WHEN reward_points > 0 THEN 1 ELSE 0 END) AS paid, SUM(CASE WHEN reward_points = 0 THEN 1 ELSE 0 END) AS pending FROM referrals WHERE referrer_id = ?'
  ).bind(user.id).first<{ paid: number | null; pending: number | null }>();

  return {
    user,
    balance,
    tier,
    cooldownRemaining: lastClaim ? cooldownRemaining(lastClaim.claimedAt, now, tier.collectCooldownSeconds) : 0,
    battleWins: wins?.wins ?? 0,
    referralCount: referrals?.paid ?? 0,
    pendingReferrals: referrals?.pending ?? 0,
    streak: await getCollectStreak(env, user.id, now)
  };
}

export async function getUserByUsername(env: Env, username: string): Promise<UserRecord | null> {
  return env.DB.prepare(
    'SELECT id, telegram_id AS telegramId, display_name AS displayName, referral_code AS referralCode, tier_id AS tierId FROM users WHERE lower(username) = ?'
  ).bind(username.replace(/^@/, '').toLowerCase()).first<UserRecord>();
}

