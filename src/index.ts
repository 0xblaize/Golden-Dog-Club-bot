import { webhookCallback } from 'grammy';
import type { UserFromGetMe } from 'grammy/types';
import { COMMAND_MENU, createBot } from './bot';
import type { Env } from './env';
import { cleanupActivity } from './services/activity';

const WEBHOOK_PATH = '/telegram/webhook';

// Cached per isolate so grammY does not call getMe on every webhook request.
let cachedBotInfo: UserFromGetMe | undefined;

export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health' && request.method === 'GET') {
      return Response.json({
        ok: true,
        service: 'telegram-points-bot',
        environment: env.ENVIRONMENT,
        databaseBinding: Boolean(env.DB),
        tokenConfigured: Boolean(env.BOT_TOKEN),
        webhookPath: WEBHOOK_PATH
      });
    }

    // Registers the emoji command menu shown in Telegram's "/" autocomplete.
    // Visit this once after deploying, or whenever COMMAND_MENU changes.
    if (url.pathname === '/setup-commands' && request.method === 'GET') {
      if (!env.BOT_TOKEN) {
        return Response.json({ ok: false, error: 'Bot token is not configured' }, { status: 500 });
      }
      const bot = createBot(env, cachedBotInfo);
      await bot.api.setMyCommands(COMMAND_MENU);
      return Response.json({ ok: true, commands: COMMAND_MENU.length });
    }

    // Telegram updates are accepted on any path so a webhook registered at "/",
    // "/telegram/webhook", or a token-suffixed URL all reach the same handler.
    if (request.method !== 'POST') {
      return new Response('Not found', { status: 404 });
    }

    if (!env.BOT_TOKEN) {
      console.error(JSON.stringify({ event: 'webhook_rejected', reason: 'BOT_TOKEN is not configured' }));
      return Response.json({ ok: false, error: 'Bot token is not configured' }, { status: 500 });
    }

    try {
      // The bot must be created inside fetch so it closes over this request's env bindings.
      const bot = createBot(env, cachedBotInfo);
      if (!cachedBotInfo) {
        await bot.init();
        cachedBotInfo = bot.botInfo;
      }
      // Return grammY's promise directly. This keeps the request alive until bot.handleUpdate
      // and the Telegram sendMessage call have completed; ctx.waitUntil is not needed here.
      return await webhookCallback(bot, 'cloudflare-mod')(request);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'telegram_webhook_failed',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      }));
      return Response.json({ ok: false }, { status: 500 });
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await cleanupActivity(env);
  }
};
