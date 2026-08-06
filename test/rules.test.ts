import { describe, expect, it } from 'vitest';
import {
  addPoints,
  battleWinChance,
  collectStreak,
  cooldownRemaining,
  formatCooldown,
  isCooldownReady,
  selectTier,
  streakMultiplier,
  strengthLabel
} from '../src/services/rules';

const tiers = [
  { id: 1, name: 'Starter', minimumPoints: 0, collectCooldownSeconds: 3600, battleLimit: 10 },
  { id: 2, name: 'Rising', minimumPoints: 1000, collectCooldownSeconds: 2700, battleLimit: 25 },
  { id: 3, name: 'Elite', minimumPoints: 5000, collectCooldownSeconds: 1800, battleLimit: 50 }
];

describe('game rules', () => {
  it('allows a first collection', () => {
    expect(isCooldownReady(null, 100, 3600)).toBe(true);
  });

  it('enforces collection cooldowns', () => {
    expect(isCooldownReady(100, 3699, 3600)).toBe(false);
    expect(cooldownRemaining(100, 3699, 3600)).toBe(1);
    expect(isCooldownReady(100, 3700, 3600)).toBe(true);
  });

  it('selects the highest unlocked tier', () => {
    expect(selectTier(4999, tiers).name).toBe('Rising');
    expect(selectTier(5000, tiers).name).toBe('Elite');
  });

  it('credits game balance and total points', () => {
    expect(addPoints({ gameBalance: 10, spotBalance: 4, totalPoints: 14 }, 25)).toEqual({
      gameBalance: 35,
      spotBalance: 4,
      totalPoints: 39
    });
  });

  it('rewards battle strength without making veterans unbeatable', () => {
    expect(battleWinChance(0, 0)).toBe(0.5);
    expect(battleWinChance(5, 0)).toBeCloseTo(0.6);
    expect(battleWinChance(0, 5)).toBeCloseTo(0.4);
    // A 500-win veteran is still beatable one time in four.
    expect(battleWinChance(500, 0)).toBe(0.75);
    expect(battleWinChance(0, 500)).toBe(0.25);
  });

  it('labels fighter strength by wins', () => {
    expect(strengthLabel(0)).toContain('Rookie');
    expect(strengthLabel(5)).toContain('Fighter');
    expect(strengthLabel(20)).toContain('Veteran');
    expect(strengthLabel(50)).toContain('Champion');
  });

  it('formats cooldowns in friendly units', () => {
    expect(formatCooldown(300)).toBe('5 mins');
    expect(formatCooldown(60)).toBe('1 min');
    expect(formatCooldown(3600)).toBe('1 hour');
    expect(formatCooldown(7200)).toBe('2 hours');
    expect(formatCooldown(90)).toBe('1m 30s');
  });

  it('counts consecutive-day collect streaks', () => {
    const day = 86400;
    const now = 10 * day + 500; // some time on day 10
    // claimed on days 8, 9, 10 → 3-day streak
    expect(collectStreak([8 * day + 10, 9 * day + 10, 10 * day + 10], now)).toBe(3);
    // claimed yesterday only → streak survives at 1 until today's collect
    expect(collectStreak([9 * day + 10], now)).toBe(1);
    // a gap breaks the run: days 7 and 9 with nothing on day 8
    expect(collectStreak([7 * day + 10, 9 * day + 10], now)).toBe(1);
    // last claim two days ago → streak is dead
    expect(collectStreak([8 * day + 10], now)).toBe(0);
    expect(collectStreak([], now)).toBe(0);
  });

  it('applies streak bonuses at day 3 and day 7', () => {
    expect(streakMultiplier(1)).toBe(1);
    expect(streakMultiplier(2)).toBe(1);
    expect(streakMultiplier(3)).toBe(1.1);
    expect(streakMultiplier(6)).toBe(1.1);
    expect(streakMultiplier(7)).toBe(1.5);
    expect(streakMultiplier(30)).toBe(1.5);
  });
});
