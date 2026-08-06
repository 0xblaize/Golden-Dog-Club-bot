import { Bot, Context, InlineKeyboard } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import type { Env } from './env';
import { allowActivity } from './services/activity';
import { acceptBattle, createBattle, findAcceptableBattle, getBattleActionLayout, getLeaderboards } from './services/battles';
import { isAdmin, addPoints as adminAddPoints, addQuiz } from './services/admin';
import { answerQuiz, getQuiz, recordReaction } from './services/games';
import {
  applyReferral,
  collectPoints,
  cooldownMessage,
  ensureUser,
  getProfile,
  getUserByUsername,
  type Profile,
  type UserRecord
} from './services/points';
import { CURRENCY, formatAmount, formatCooldown, formatDuration, streakLine, strengthLabel, tierBadge } from './services/rules';

const RULE = '━━━━━━━━━━━━━━━━━━━';

// Display names come from Telegram and can contain <, > or &, which would break
// every HTML-parsed reply they appear in.
function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function displayName(ctx: Context): string {
  if (!ctx.from) return 'Player';
  return [ctx.from.first_name, ctx.from.last_name].filter(Boolean).join(' ') || ctx.from.username || 'Player';
}

async function player(ctx: Context, env: Env): Promise<UserRecord | null> {
  if (!ctx.from) return null;
  return ensureUser(env, ctx.from.id, displayName(ctx), ctx.from.username);
}

async function allowed(ctx: Context, env: Env, event: string): Promise<boolean> {
  const user = await player(ctx, env);
  if (!user) return false;
  if (await allowActivity(env, user.id, event)) return true;
  await ctx.reply('⏳ Too many actions in a short period. Please try again in a minute.');
  return false;
}

function referralLink(ctx: Context, code: string): string {
  return `https://t.me/${ctx.me.username}?start=${code}`;
}

function profileCard(profile: Profile, heading: string): string {
  const { user, balance, tier, cooldownRemaining, battleWins, referralCount } = profile;
  const collectLine = cooldownRemaining === 0
    ? '✅ Collect is ready — tap Collect or send /collect'
    : `⏳ Next collect in ${formatDuration(cooldownRemaining)}`;

  return [
    `${heading}`,
    RULE,
    `👤 ${esc(user.displayName)}`,
    `🏆 ${tierBadge(tier.name)} · ${strengthLabel(battleWins)}`,
    RULE,
    `🎮 Game    ${formatAmount(balance.gameBalance)}`,
    `💠 Spot    ${formatAmount(balance.spotBalance)}`,
    `📊 Total   ${formatAmount(balance.totalPoints)}`,
    RULE,
    collectLine,
    streakLine(profile.streak),
    `⚔️ Battle cap ${tier.battleLimit} ${CURRENCY} · ${battleWins} wins`,
    `⏱ Collect cycle ${formatCooldown(tier.collectCooldownSeconds)}`,
    `🤝 Friends invited: ${referralCount}`
  ].join('\n');
}

function mainKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text('💰 Collect', 'act:collect')
    .text('📊 Balance', 'act:balance')
    .row()
    .text('⚔️ Battle', 'act:battle')
    .text('🏅 Leaderboard', 'act:leaderboard')
    .row()
    .text('🧠 Quiz', 'act:quiz')
    .text('😄 Reaction', 'act:reaction')
    .row()
    .text('🤝 Invite', 'act:referral')
    .text('📖 Commands', 'act:commands');
}

const COMMAND_LIST = [
  '📖 <b>Command Center</b>',
  RULE,
  '🚀 /start — open your player card',
  '📊 /balance — check your points',
  '📇 /profile — your full player card',
  '🕵️ /profile @user — scout a rival',
  '💰 /collect — claim your timed points',
  '⚔️ /battle &lt;amount&gt; — challenge a random rival in your tier',
  '🎯 /battle @user &lt;amount&gt; — call out a specific player',
  '🤝 /accept — accept the battle waiting for you',
  '🏅 /leaderboard — top collectors and battlers',
  '🧠 /quiz — answer trivia for points',
  '😄 /react — daily mood check-in bonus',
  '🎁 /referral — get your invite link',
  '📖 /commands — show this list',
  'ℹ️ /help — quick start guide'
].join('\n');

export const COMMAND_MENU = [
  { command: 'start', description: '🚀 Open your player card' },
  { command: 'collect', description: '💰 Claim your timed points' },
  { command: 'balance', description: '📊 Check your points' },
  { command: 'profile', description: '📇 Your player card / scout a rival' },
  { command: 'battle', description: '⚔️ Challenge a rival' },
  { command: 'accept', description: '🤝 Accept a battle' },
  { command: 'leaderboard', description: '🏅 Top players' },
  { command: 'quiz', description: '🧠 Answer trivia for points' },
  { command: 'react', description: '😄 Daily mood bonus' },
  { command: 'referral', description: '🎁 Get your invite link' },
  { command: 'commands', description: '📖 All commands' },
  { command: 'help', description: 'ℹ️ Quick start guide' }
];

export function createBot(env: Env, botInfo?: UserFromGetMe): Bot<Context> {
  if (!env.BOT_TOKEN) throw new Error('BOT_TOKEN is not configured');

  const bot = new Bot<Context>(env.BOT_TOKEN, botInfo ? { botInfo } : undefined);

  // Every action lives in a plain function so a command and its inline button
  // run identical logic. Buttons previously re-sent "/collect" as a bot message,
  // which Telegram never routes back into the bot's own command handlers.
  const actions = {
    async balance(ctx: Context): Promise<void> {
      if (!(await allowed(ctx, env, 'balance'))) return;
      const user = await player(ctx, env);
      if (!user) return;
      const profile = await getProfile(env, user);
      await ctx.reply(profileCard(profile, '📊 <b>Your Player Card</b>'), {
        parse_mode: 'HTML',
        reply_markup: mainKeyboard()
      });
    },

    async collect(ctx: Context): Promise<void> {
      if (!(await allowed(ctx, env, 'collect'))) return;
      const user = await player(ctx, env);
      if (!user) return;
      const result = await collectPoints(env, user);
      if (!result.ok) {
        await ctx.reply(`⏳ ${cooldownMessage(result.remaining)}`, { reply_markup: mainKeyboard() });
        return;
      }
      await ctx.reply(
        [
          `💰 <b>+${result.points} ${CURRENCY} collected!</b>`,
          RULE,
          streakLine(result.streak),
          `🎮 Game  ${formatAmount(result.balance.gameBalance)}`,
          `📊 Total ${formatAmount(result.balance.totalPoints)}`,
          `🏆 ${tierBadge(result.tier.name)}`,
          `⏱ Come back in ${formatCooldown(result.tier.collectCooldownSeconds)}`
        ].join('\n'),
        { parse_mode: 'HTML', reply_markup: mainKeyboard() }
      );
    },

    async leaderboard(ctx: Context): Promise<void> {
      if (!(await allowed(ctx, env, 'leaderboard'))) return;
      const boards = await getLeaderboards(env);
      await ctx.reply(
        [
          '🏅 <b>Hall of Fame</b>',
          RULE,
          '💰 <b>Top Collectors</b>',
          boards.collectors.join('\n') || 'No collection activity yet.',
          '',
          '⚔️ <b>Top Battlers</b>',
          boards.battlers.join('\n') || 'No battles yet.'
        ].join('\n'),
        { parse_mode: 'HTML', reply_markup: mainKeyboard() }
      );
    },

    async quiz(ctx: Context): Promise<void> {
      if (!(await allowed(ctx, env, 'quiz'))) return;
      const question = await getQuiz(env);
      if (!question) {
        await ctx.reply('🧠 There are no active quiz questions right now.');
        return;
      }
      const keyboard = new InlineKeyboard();
      question.options.forEach((option, index) => keyboard.text(option, `quiz:${question.id}:${index}`).row());
      await ctx.reply(`🧠 <b>Quiz time</b> · ${question.category} · ${question.difficulty}\n🎟 5 attempts per day\n${RULE}\n${question.question}`, {
        parse_mode: 'HTML',
        reply_markup: keyboard
      });
    },

    async reaction(ctx: Context): Promise<void> {
      if (!(await allowed(ctx, env, 'reaction'))) return;
      const user = await player(ctx, env);
      if (!user) return;
      const result = await recordReaction(env, user.id, 'daily');
      if ('error' in result) {
        await ctx.reply(`😐 ${result.error}`, { reply_markup: mainKeyboard() });
        return;
      }
      await ctx.reply(
        `😄 <b>Mood logged!</b>\n${RULE}\n✨ ${result.multiplier}x multiplier\n💰 +${result.reward} ${CURRENCY}`,
        { parse_mode: 'HTML', reply_markup: mainKeyboard() }
      );
    },

    async referral(ctx: Context): Promise<void> {
      if (!(await allowed(ctx, env, 'referral'))) return;
      const user = await player(ctx, env);
      if (!user) return;
      const profile = await getProfile(env, user);
      const link = referralLink(ctx, user.referralCode);
      await ctx.reply(
        [
          '🤝 <b>Invite &amp; Earn</b>',
          RULE,
          `Share your link and earn <b>250 ${CURRENCY}</b> for every friend who joins and completes 3 collects.`,
          '',
          `🔗 ${link}`,
          `🎟 Code: <code>${user.referralCode}</code>`,
          `👥 Friends rewarded: ${profile.referralCount}`,
          `⏳ Pending (still collecting): ${profile.pendingReferrals}`
        ].join('\n'),
        {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().url(
            '📨 Share invite',
            `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent('Join me in the points arena!')}`
          )
        }
      );
    },

    async commands(ctx: Context): Promise<void> {
      await ctx.reply(COMMAND_LIST, { parse_mode: 'HTML', reply_markup: mainKeyboard() });
    },

    async battlePrompt(ctx: Context): Promise<void> {
      if (!(await allowed(ctx, env, 'battle'))) return;
      const user = await player(ctx, env);
      if (!user) return;
      const profile = await getProfile(env, user);
      await ctx.reply(
        [
          '⚔️ <b>Arena</b>',
          RULE,
          `🏆 ${tierBadge(profile.tier.name)} · ${strengthLabel(profile.battleWins)} (${profile.battleWins} wins)`,
          `💪 Every win you bank makes you stronger in future fights.`,
          '',
          `🎲 <code>/battle 50</code> — open challenge to your tier`,
          `🎯 <code>/battle @user 50</code> — call out a rival`,
          `🤝 <code>/accept</code> — take the fight waiting for you`,
          '',
          `Max wager at your tier: <b>${profile.tier.battleLimit} ${CURRENCY}</b>`
        ].join('\n'),
        { parse_mode: 'HTML' }
      );
    }
  };

  bot.command('start', async (ctx) => {
    const telegramId = ctx.from?.id;
    try {
      if (!ctx.from) return;
      console.log(JSON.stringify({ event: 'start_received', telegramId }));

      const user = await player(ctx, env);
      if (!user) return;

      const payload = ctx.match.trim();
      const referred = payload ? await applyReferral(env, user, payload) : false;
      const profile = await getProfile(env, user);

      const lines = [profileCard(profile, '🎯 <b>Welcome to the Arena</b>')];
      if (referred) lines.push('', '🎁 Invite accepted! Your inviter gets rewarded after your first 3 collects.');
      lines.push('', '💡 Tap a button below or send /commands for everything.');

      await ctx.reply(lines.join('\n'), { parse_mode: 'HTML', reply_markup: mainKeyboard() });
      console.log(JSON.stringify({ event: 'start_completed', telegramId, userId: user.id }));
    } catch (error) {
      console.error(JSON.stringify({
        event: 'start_failed',
        telegramId,
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      }));
      await ctx.reply('⚠️ I could not open your profile right now. Please try /start again.');
    }
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        'ℹ️ <b>Quick start</b>',
        RULE,
        '1️⃣ /collect to claim points on a timer',
        '2️⃣ /battle to wager them against rivals',
        '3️⃣ /quiz and /react for bonus points',
        '4️⃣ /referral to earn from invites',
        '',
        'Send /commands for the full list.'
      ].join('\n'),
      { parse_mode: 'HTML', reply_markup: mainKeyboard() }
    );
  });

  bot.command(['commands', 'command'], (ctx) => actions.commands(ctx));
  bot.command('balance', (ctx) => actions.balance(ctx));
  bot.command('collect', (ctx) => actions.collect(ctx));
  bot.command('leaderboard', (ctx) => actions.leaderboard(ctx));
  bot.command('quiz', (ctx) => actions.quiz(ctx));
  bot.command('react', (ctx) => actions.reaction(ctx));
  bot.command(['referral', 'invite'], (ctx) => actions.referral(ctx));

  bot.command('profile', async (ctx) => {
    if (!(await allowed(ctx, env, 'profile'))) return;
    const target = ctx.match.trim().split(/\s+/)[0];
    if (target && target.startsWith('@')) {
      const other = await getUserByUsername(env, target);
      if (!other) {
        await ctx.reply('🔍 That player has not started the bot yet.');
        return;
      }
      const profile = await getProfile(env, other);
      // Rival view: public stats only — no balances or collect timing.
      await ctx.reply(
        [
          `🕵️ <b>Rival Card</b>`,
          RULE,
          `👤 ${esc(other.displayName)}`,
          `🏆 ${tierBadge(profile.tier.name)} · ${strengthLabel(profile.battleWins)}`,
          `⚔️ ${profile.battleWins} battle wins`,
          streakLine(profile.streak),
          RULE,
          `🎯 Challenge them: <code>/battle ${target} 50</code>`
        ].join('\n'),
        { parse_mode: 'HTML' }
      );
      return;
    }
    const user = await player(ctx, env);
    if (!user) return;
    const profile = await getProfile(env, user);
    await ctx.reply(profileCard(profile, '📇 <b>Your Player Card</b>'), {
      parse_mode: 'HTML',
      reply_markup: mainKeyboard()
    });
  });

  bot.command('battle', async (ctx) => {
    if (!(await allowed(ctx, env, 'battle'))) return;
    const user = await player(ctx, env);
    if (!user) return;

    const parts = ctx.match.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0) {
      await actions.battlePrompt(ctx);
      return;
    }

    // Accepts "/battle 50", "/battle @user 50" and "/battle 50 @user".
    const tagged = parts.find((part) => part.startsWith('@')) ?? null;
    const wagerText = parts.find((part) => !part.startsWith('@'));
    const wager = Number(wagerText);

    if (!wagerText || !Number.isFinite(wager)) {
      await ctx.reply('⚔️ Usage: <code>/battle 50</code> or <code>/battle @user 50</code>', { parse_mode: 'HTML' });
      return;
    }

    const result = await createBattle(env, user.id, tagged, wager, ctx.chat?.id ?? 0);
    if ('error' in result) {
      await ctx.reply(`⚠️ ${result.error}`);
      return;
    }

    const keyboard = new InlineKeyboard().text('⚔️ Accept battle', `battle:${result.id}`);
    const opponentMention = result.opponentTelegramId
      ? `<a href="tg://user?id=${result.opponentTelegramId}">${esc(result.opponentName ?? 'Player')}</a>`
      : '';
    const headline = result.open
      ? `🎲 <b>${esc(result.challengerName)}</b> opened a challenge for <b>${result.wager} ${CURRENCY}</b>!\nAnyone in the same tier can take it.`
      : `🎯 <b>${esc(result.challengerName)}</b> challenged ${opponentMention} for <b>${result.wager} ${CURRENCY}</b>!`;
    const layout = getBattleActionLayout(result);
    const challengerReplyText = layout.sendPrivateNotification
      ? `${headline}\n${RULE}\nA private challenge was sent to ${opponentMention || 'the opponent'}.`
      : `${headline}\n${RULE}\nTap below or send <code>/accept ${result.id}</code>.`;

    await ctx.reply(challengerReplyText, {
      parse_mode: 'HTML',
      reply_markup: layout.showAcceptButtonInChallengerReply ? keyboard : undefined
    });

    if (layout.sendPrivateNotification && result.opponentTelegramId) {
      try {
        await ctx.api.sendMessage(
          result.opponentTelegramId,
          [
            `⚔️ <b>${esc(result.challengerName)} challenged you!</b>`,
            RULE,
            `Wager: <b>${result.wager} ${CURRENCY}</b>`,
            'Accept the battle before it expires in 1 hour.'
          ].join('\\n'),
          { parse_mode: 'HTML', reply_markup: keyboard }
        );
      } catch (notificationError) {
        // Telegram rejects private delivery when the target has not opened the
        // bot or has blocked it; the group notification remains available.
        console.warn(JSON.stringify({
          event: 'battle_notification_failed',
          battleId: result.id,
          telegramId: result.opponentTelegramId,
          message: notificationError instanceof Error ? notificationError.message : String(notificationError)
        }));
      }
    }
  });

  bot.command('accept', async (ctx) => {
    if (!(await allowed(ctx, env, 'accept_battle'))) return;
    const user = await player(ctx, env);
    if (!user) return;
    const idText = ctx.match.trim();
    await resolveBattle(ctx, user, idText ? Number(idText) : undefined);
  });

  bot.command('admin_add_points', async (ctx) => {
    if (!ctx.from || !isAdmin(env, ctx.from.id)) return;
    const [telegramIdText, pointsText] = ctx.match.trim().split(/\s+/);
    const success = await adminAddPoints(env, Number(telegramIdText), Number(pointsText));
    await ctx.reply(success ? '✅ Points updated.' : '⚠️ Invalid user or point amount.');
  });

  bot.command('admin_quiz', async (ctx) => {
    if (!ctx.from || !isAdmin(env, ctx.from.id)) return;
    const success = await addQuiz(env, ctx.match.trim());
    await ctx.reply(success ? '✅ Quiz question added.' : '⚠️ Use: /admin_quiz question|option 1|option 2|correct index|reward');
  });

  async function resolveBattle(ctx: Context, user: UserRecord, battleId?: number): Promise<void> {
    if (battleId !== undefined && !Number.isFinite(battleId)) {
      await ctx.reply('⚠️ Use /accept or /accept <battle id>.');
      return;
    }
    const pending = await findAcceptableBattle(env, user.id, battleId);
    if (!pending) {
      await ctx.reply('🕊 There is no battle waiting for you right now. Start one with /battle 50.');
      return;
    }
    const result = await acceptBattle(env, user.id, pending.id);
    if ('error' in result) {
      await ctx.reply(`⚠️ ${result.error}`);
      return;
    }
    await ctx.reply(
      [
        '⚔️ <b>Battle resolved!</b>',
        RULE,
        `🏆 Winner: <b>${esc(result.winnerName)}</b> (+${result.wager * 2} ${CURRENCY})`,
        `💀 Defeated: ${esc(result.loserName)} (-${result.wager} ${CURRENCY})`,
        `🎲 Win odds were ${Math.round(result.winChance * 100)}% — strength from past wins counts.`
      ].join('\n'),
      { parse_mode: 'HTML' }
    );
  }

  // Inline buttons run the same handlers as the commands and always reply.
  const buttonActions: Record<string, (ctx: Context) => Promise<void>> = {
    collect: actions.collect,
    balance: actions.balance,
    leaderboard: actions.leaderboard,
    quiz: actions.quiz,
    reaction: actions.reaction,
    referral: actions.referral,
    commands: actions.commands,
    battle: actions.battlePrompt
  };

  bot.callbackQuery(/^act:(\w+)$/, async (ctx) => {
    const key = ctx.callbackQuery.data.slice(4);
    const handler = buttonActions[key];
    await ctx.answerCallbackQuery();
    if (handler) await handler(ctx);
  });

  bot.callbackQuery(/^battle:(\d+)$/, async (ctx) => {
    await ctx.answerCallbackQuery();
    if (!(await allowed(ctx, env, 'accept_battle'))) return;
    const user = await player(ctx, env);
    if (!user) return;
    await resolveBattle(ctx, user, Number(ctx.callbackQuery.data.slice(7)));
  });

  bot.callbackQuery(/^quiz:(\d+):(\d+)$/, async (ctx) => {
    const match = ctx.callbackQuery.data.match(/^quiz:(\d+):(\d+)$/);
    if (!match || !ctx.from) return;
    await ctx.answerCallbackQuery();
    const user = await player(ctx, env);
    if (!user) return;
    const result = await answerQuiz(env, user.id, Number(match[1]), Number(match[2]));
    if ('error' in result) {
      await ctx.reply(`⚠️ ${result.error}`);
      return;
    }
    await ctx.reply(
      result.correct ? `✅ Correct! +${result.reward} ${CURRENCY}` : '❌ Not quite. Try the next one.',
      { reply_markup: mainKeyboard() }
    );
  });

  bot.catch((error) => {
    console.error(JSON.stringify({
      event: 'telegram_update_failed',
      message: error.error instanceof Error ? error.error.message : String(error.error),
      stack: error.error instanceof Error ? error.error.stack : undefined
    }));
  });

  return bot;
}
