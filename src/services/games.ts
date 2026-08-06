import type { Env } from '../env';

const REACTION_REWARD = 25;
const DAILY_QUIZ_LIMIT = 5;

export async function getQuiz(env: Env): Promise<{ id: number; question: string; options: string[]; category: string; difficulty: string } | null> {
  const question = await env.DB.prepare(
    `SELECT id, question, options_json AS optionsJson, category, difficulty FROM quiz_questions WHERE active = 1 ORDER BY RANDOM() LIMIT 1`
  ).first<{ id: number; question: string; optionsJson: string; category: string; difficulty: string }>();
  if (!question) return null;
  return {
    id: question.id,
    question: question.question,
    options: JSON.parse(question.optionsJson) as string[],
    category: question.category,
    difficulty: question.difficulty
  };
}

export async function answerQuiz(env: Env, userId: number, questionId: number, selectedOption: number): Promise<{ correct: boolean; reward: number } | { error: string }> {
  if (!Number.isInteger(selectedOption) || selectedOption < 0 || selectedOption > 3) {
    return { error: 'That answer is not valid.' };
  }

  const question = await env.DB.prepare(
    'SELECT correct_option AS correctOption, reward_points AS reward FROM quiz_questions WHERE id = ? AND active = 1'
  ).bind(questionId).first<{ correctOption: number; reward: number }>();
  if (!question) return { error: 'That quiz question is no longer active.' };

  const previous = await env.DB.prepare('SELECT id FROM quiz_answers WHERE question_id = ? AND user_id = ?').bind(questionId, userId).first<{ id: number }>();
  if (previous) return { error: 'You already answered that question.' };

  const now = Math.floor(Date.now() / 1000);
  const dayStart = Math.floor(now / 86400) * 86400;
  const correct = question.correctOption === selectedOption;
  const reward = correct ? question.reward : 0;

  // The count check is inside the INSERT so concurrent button presses cannot
  // push a player over the five-attempt daily limit.
  const answer = await env.DB.prepare(
    `INSERT INTO quiz_answers (question_id, user_id, selected_option, correct, created_at)
     SELECT ?, ?, ?, ?, ?
     WHERE (SELECT COUNT(*) FROM quiz_answers WHERE user_id = ? AND created_at >= ?) < ?
       AND NOT EXISTS (SELECT 1 FROM quiz_answers WHERE question_id = ? AND user_id = ?)`
  ).bind(
    questionId,
    userId,
    selectedOption,
    correct ? 1 : 0,
    now,
    userId,
    dayStart,
    DAILY_QUIZ_LIMIT,
    questionId,
    userId
  ).run();

  if (answer.meta.changes !== 1) {
    const today = await env.DB.prepare(
      'SELECT COUNT(*) AS total FROM quiz_answers WHERE user_id = ? AND created_at >= ?'
    ).bind(userId, dayStart).first<{ total: number }>();
    if ((today?.total ?? 0) >= DAILY_QUIZ_LIMIT) {
      return { error: 'You have used all 5 quiz attempts for today. Come back tomorrow.' };
    }
    return { error: 'You already answered that question.' };
  }

  if (reward) {
    await env.DB.prepare(
      'UPDATE balances SET game_balance = game_balance + ?, total_points = total_points + ?, updated_at = ? WHERE user_id = ?'
    ).bind(reward, reward, now, userId).run();
  }
  return { correct, reward };
}

export async function recordReaction(env: Env, userId: number, eventType: string): Promise<{ reward: number; multiplier: number } | { error: string }> {
  const now = Math.floor(Date.now() / 1000);
  // created_at is stored in seconds, so the day boundary must be derived from
  // seconds too — deriving it from milliseconds never matches and lets the
  // daily reward be claimed repeatedly.
  const dayStart = Math.floor(now / 86400) * 86400;
  const previous = await env.DB.prepare(
    'SELECT id FROM reaction_events WHERE user_id = ? AND event_type = ? AND created_at >= ?'
  ).bind(userId, eventType, dayStart).first<{ id: number }>();
  if (previous) return { error: 'You already claimed today’s reaction reward.' };

  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  const multiplier = (values[0] % 3) + 1;
  const reward = REACTION_REWARD * multiplier;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO reaction_events (user_id, event_type, multiplier, reward_points, created_at) VALUES (?, ?, ?, ?, ?)').bind(userId, eventType, multiplier, reward, now),
    env.DB.prepare('UPDATE balances SET game_balance = game_balance + ?, total_points = total_points + ?, updated_at = ? WHERE user_id = ?').bind(reward, reward, now, userId)
  ]);
  return { reward, multiplier };
}

export async function createQuiz(env: Env, question: string, options: string[], correctOption: number, reward: number): Promise<void> {
  await env.DB.prepare(
    'INSERT INTO quiz_questions (question, options_json, correct_option, reward_points, active) VALUES (?, ?, ?, ?, 1)'
  ).bind(question, JSON.stringify(options), correctOption, reward).run();
}
