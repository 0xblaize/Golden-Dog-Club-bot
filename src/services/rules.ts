export interface TierRule {
  id: number;
  name: string;
  minimumPoints: number;
  collectCooldownSeconds: number;
  battleLimit: number;
}

export interface Balance {
  gameBalance: number;
  spotBalance: number;
  totalPoints: number;
}

export const CURRENCY = 'PTS';

const TIER_EMOJI: Record<string, string> = {
  Starter: '🌱',
  Rising: '🔥',
  Elite: '💎',
  Legend: '👑'
};

export function isCooldownReady(lastClaimAt: number | null, now: number, cooldownSeconds: number): boolean {
  return lastClaimAt === null || now - lastClaimAt >= cooldownSeconds;
}

export function cooldownRemaining(lastClaimAt: number, now: number, cooldownSeconds: number): number {
  return Math.max(0, cooldownSeconds - (now - lastClaimAt));
}

export function selectTier(totalPoints: number, tiers: TierRule[]): TierRule {
  return tiers
    .filter((tier) => tier.minimumPoints <= totalPoints)
    .sort((a, b) => b.minimumPoints - a.minimumPoints)[0] ?? tiers[0];
}

export function addPoints(balance: Balance, points: number): Balance {
  return {
    gameBalance: balance.gameBalance + points,
    spotBalance: balance.spotBalance,
    totalPoints: balance.totalPoints + points
  };
}

export function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const remainingSeconds = seconds % 60;
  return [hours ? `${hours}h` : '', minutes ? `${minutes}m` : '', remainingSeconds ? `${remainingSeconds}s` : '0s']
    .filter(Boolean)
    .join(' ');
}

export function tierBadge(name: string): string {
  return `${TIER_EMOJI[name] ?? '🎖'} ${name}`;
}

export function formatAmount(points: number): string {
  return `${points.toLocaleString('en-US')} ${CURRENCY}`;
}

export function formatCooldown(seconds: number): string {
  if (seconds % 3600 === 0) {
    const hours = seconds / 3600;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  if (seconds % 60 === 0) {
    const minutes = seconds / 60;
    return `${minutes} ${minutes === 1 ? 'min' : 'mins'}`;
  }
  return formatDuration(seconds);
}

// Battle strength comes from wins earned in the arena. Each win shifts the odds
// slightly, but the clamp keeps a veteran from being unbeatable by a newcomer.
export function battleWinChance(challengerWins: number, opponentWins: number): number {
  const shift = (challengerWins - opponentWins) * 0.02;
  return Math.min(0.75, Math.max(0.25, 0.5 + shift));
}

export function strengthLabel(wins: number): string {
  if (wins >= 50) return '👑 Champion';
  if (wins >= 20) return '💎 Veteran';
  if (wins >= 5) return '🔥 Fighter';
  return '🌱 Rookie';
}

const DAY_SECONDS = 86400;

/**
 * Counts consecutive UTC days with at least one claim, ending today or
 * yesterday (yesterday keeps a streak alive until today's collect lands).
 * claimDays are unix timestamps of past claims, any order.
 */
export function collectStreak(claimDays: number[], now: number): number {
  const days = new Set(claimDays.map((ts) => Math.floor(ts / DAY_SECONDS)));
  const today = Math.floor(now / DAY_SECONDS);
  let cursor = days.has(today) ? today : today - 1;
  let streak = 0;
  while (days.has(cursor)) {
    streak += 1;
    cursor -= 1;
  }
  return streak;
}

/** Streak bonus applied to the collect reward: +10% from day 3, +50% from day 7. */
export function streakMultiplier(streak: number): number {
  if (streak >= 7) return 1.5;
  if (streak >= 3) return 1.1;
  return 1;
}

export function streakLine(streak: number): string {
  if (streak <= 0) return '🔥 Streak: none — collect today to start one';
  const bonus = streakMultiplier(streak);
  const bonusText = bonus > 1 ? ` (+${Math.round((bonus - 1) * 100)}% bonus)` : '';
  return `🔥 Streak: ${streak} day${streak === 1 ? '' : 's'}${bonusText}`;
}
