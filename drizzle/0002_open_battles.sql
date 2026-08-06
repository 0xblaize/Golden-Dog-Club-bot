-- Open battles need a nullable opponent (random skill-group matchmaking) and a
-- chat id so a group challenge can be answered in the chat it was raised in.
-- SQLite cannot drop a NOT NULL constraint in place, so the table is rebuilt.
ALTER TABLE `battles` RENAME TO `battles_old`;

CREATE TABLE `battles` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `challenger_id` integer NOT NULL REFERENCES `users`(`id`),
  `opponent_id` integer REFERENCES `users`(`id`),
  `wager_points` integer NOT NULL,
  `winner_id` integer REFERENCES `users`(`id`),
  `status` text NOT NULL,
  `chat_id` integer,
  `created_at` integer NOT NULL,
  `resolved_at` integer
);

INSERT INTO `battles` (`id`, `challenger_id`, `opponent_id`, `wager_points`, `winner_id`, `status`, `chat_id`, `created_at`, `resolved_at`)
SELECT `id`, `challenger_id`, `opponent_id`, `wager_points`, `winner_id`, `status`, NULL, `created_at`, `resolved_at` FROM `battles_old`;

DROP TABLE `battles_old`;

CREATE INDEX IF NOT EXISTS `battles_status_idx` ON `battles` (`status`, `created_at`);
CREATE INDEX IF NOT EXISTS `battles_winner_idx` ON `battles` (`winner_id`);

-- Faster collect cadence so the early game stays active.
UPDATE `tiers` SET `collect_cooldown_seconds` = 300 WHERE `id` = 1;
UPDATE `tiers` SET `collect_cooldown_seconds` = 240 WHERE `id` = 2;
UPDATE `tiers` SET `collect_cooldown_seconds` = 180 WHERE `id` = 3;
UPDATE `tiers` SET `collect_cooldown_seconds` = 120 WHERE `id` = 4;
