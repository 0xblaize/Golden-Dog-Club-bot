import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  telegramId: integer('telegram_id').notNull().unique(),
  username: text('username'),
  displayName: text('display_name').notNull(),
  referralCode: text('referral_code').notNull().unique(),
  tierId: integer('tier_id').notNull().default(1),
  createdAt: integer('created_at').notNull(),
  lastActiveAt: integer('last_active_at').notNull()
});

export const balances = sqliteTable('balances', {
  userId: integer('user_id').primaryKey().references(() => users.id),
  gameBalance: integer('game_balance').notNull().default(0),
  spotBalance: integer('spot_balance').notNull().default(0),
  totalPoints: integer('total_points').notNull().default(0),
  updatedAt: integer('updated_at').notNull()
});

export const tiers = sqliteTable('tiers', {
  id: integer('id').primaryKey(),
  name: text('name').notNull().unique(),
  minimumPoints: integer('minimum_points').notNull(),
  collectCooldownSeconds: integer('collect_cooldown_seconds').notNull(),
  battleLimit: integer('battle_limit').notNull()
});

export const referrals = sqliteTable('referrals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  referrerId: integer('referrer_id').notNull().references(() => users.id),
  referredUserId: integer('referred_user_id').notNull().unique().references(() => users.id),
  rewardPoints: integer('reward_points').notNull(),
  createdAt: integer('created_at').notNull()
});

export const collectionClaims = sqliteTable('collection_claims', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  points: integer('points').notNull(),
  claimedAt: integer('claimed_at').notNull()
});

export const activityEvents = sqliteTable('activity_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  eventType: text('event_type').notNull(),
  createdAt: integer('created_at').notNull()
});

export const battles = sqliteTable('battles', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  challengerId: integer('challenger_id').notNull().references(() => users.id),
  opponentId: integer('opponent_id').references(() => users.id),
  wagerPoints: integer('wager_points').notNull(),
  winnerId: integer('winner_id').references(() => users.id),
  status: text('status').notNull(),
  chatId: integer('chat_id'),
  createdAt: integer('created_at').notNull(),
  resolvedAt: integer('resolved_at')
});

export const quizQuestions = sqliteTable('quiz_questions', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  question: text('question').notNull(),
  optionsJson: text('options_json').notNull(),
  correctOption: integer('correct_option').notNull(),
  rewardPoints: integer('reward_points').notNull(),
  category: text('category').notNull().default('general'),
  difficulty: text('difficulty').notNull().default('easy'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true)
});

export const quizAnswers = sqliteTable('quiz_answers', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  questionId: integer('question_id').notNull().references(() => quizQuestions.id),
  userId: integer('user_id').notNull().references(() => users.id),
  selectedOption: integer('selected_option').notNull(),
  correct: integer('correct', { mode: 'boolean' }).notNull(),
  createdAt: integer('created_at').notNull()
});

export const reactionEvents = sqliteTable('reaction_events', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  userId: integer('user_id').notNull().references(() => users.id),
  eventType: text('event_type').notNull(),
  multiplier: integer('multiplier').notNull(),
  rewardPoints: integer('reward_points').notNull(),
  createdAt: integer('created_at').notNull()
});
