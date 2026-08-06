import { describe, expect, it } from 'vitest';
import { getBattleActionLayout } from '../src/services/battles';

describe('battle notification layout', () => {
  it('sends direct challenges privately and keeps the accept button on the recipient', () => {
    const layout = getBattleActionLayout({ open: false, opponentTelegramId: 12345 });

    expect(layout.sendPrivateNotification).toBe(true);
    expect(layout.showAcceptButtonInChallengerReply).toBe(false);
  });

  it('keeps open challenges public so anyone in the tier can accept', () => {
    const layout = getBattleActionLayout({ open: true, opponentTelegramId: null });

    expect(layout.sendPrivateNotification).toBe(false);
    expect(layout.showAcceptButtonInChallengerReply).toBe(true);
  });
});
