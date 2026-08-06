CREATE TABLE `tiers` (
  `id` integer PRIMARY KEY NOT NULL,
  `name` text NOT NULL UNIQUE,
  `minimum_points` integer NOT NULL,
  `collect_cooldown_seconds` integer NOT NULL,
  `battle_limit` integer NOT NULL
);

CREATE TABLE `users` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `telegram_id` integer NOT NULL UNIQUE,
  `username` text,
  `display_name` text NOT NULL,
  `referral_code` text NOT NULL UNIQUE,
  `tier_id` integer NOT NULL DEFAULT 1 REFERENCES `tiers`(`id`),
  `created_at` integer NOT NULL,
  `last_active_at` integer NOT NULL
);

CREATE TABLE `balances` (
  `user_id` integer PRIMARY KEY NOT NULL REFERENCES `users`(`id`),
  `game_balance` integer NOT NULL DEFAULT 0,
  `spot_balance` integer NOT NULL DEFAULT 0,
  `total_points` integer NOT NULL DEFAULT 0,
  `updated_at` integer NOT NULL
);

CREATE TABLE `referrals` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `referrer_id` integer NOT NULL REFERENCES `users`(`id`),
  `referred_user_id` integer NOT NULL UNIQUE REFERENCES `users`(`id`),
  `reward_points` integer NOT NULL,
  `created_at` integer NOT NULL
);

CREATE TABLE `collection_claims` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`),
  `points` integer NOT NULL,
  `claimed_at` integer NOT NULL
);

CREATE TABLE `activity_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`),
  `event_type` text NOT NULL,
  `created_at` integer NOT NULL
);

CREATE TABLE `battles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `challenger_id` integer NOT NULL REFERENCES `users`(`id`),
  `opponent_id` integer NOT NULL REFERENCES `users`(`id`),
  `wager_points` integer NOT NULL,
  `winner_id` integer REFERENCES `users`(`id`),
  `status` text NOT NULL,
  `created_at` integer NOT NULL,
  `resolved_at` integer
);

CREATE TABLE `quiz_questions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `question` text NOT NULL,
  `options_json` text NOT NULL,
  `correct_option` integer NOT NULL,
  `reward_points` integer NOT NULL,
  `active` integer NOT NULL DEFAULT 1
);

CREATE TABLE `quiz_answers` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `question_id` integer NOT NULL REFERENCES `quiz_questions`(`id`),
  `user_id` integer NOT NULL REFERENCES `users`(`id`),
  `selected_option` integer NOT NULL,
  `correct` integer NOT NULL,
  `created_at` integer NOT NULL
);

CREATE TABLE `reaction_events` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `user_id` integer NOT NULL REFERENCES `users`(`id`),
  `event_type` text NOT NULL,
  `multiplier` integer NOT NULL,
  `reward_points` integer NOT NULL,
  `created_at` integer NOT NULL
);

INSERT INTO `tiers` (`id`, `name`, `minimum_points`, `collect_cooldown_seconds`, `battle_limit`) VALUES
  (1, 'Starter', 0, 3600, 10),
  (2, 'Rising', 1000, 2700, 25),
  (3, 'Elite', 5000, 1800, 50),
  (4, 'Legend', 25000, 900, 100);

CREATE INDEX `collection_claims_user_claimed_idx` ON `collection_claims` (`user_id`, `claimed_at`);
CREATE INDEX `activity_events_user_created_idx` ON `activity_events` (`user_id`, `created_at`);
