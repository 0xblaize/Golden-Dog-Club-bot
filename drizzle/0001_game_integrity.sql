INSERT INTO `quiz_questions` (`question`, `options_json`, `correct_option`, `reward_points`, `active`)
SELECT 'Which command claims your timed points?', '["/collect","/battle","/quiz"]', 0, 75, 1
WHERE NOT EXISTS (SELECT 1 FROM `quiz_questions` WHERE `question` = 'Which command claims your timed points?');

CREATE UNIQUE INDEX IF NOT EXISTS `quiz_answers_question_user_idx` ON `quiz_answers` (`question_id`, `user_id`);
CREATE INDEX IF NOT EXISTS `battles_status_idx` ON `battles` (`status`, `created_at`);
