import { describe, expect, it } from 'vitest';

import {
  appendChatLine, buildNativeNotification, getChatNotificationId, parseNotificationTarget,
} from './nativeNotifications';

describe('уведомления приложения', () => {
  it('у чата одно уведомление: номер постоянный и свой для каждого чата и слота', () => {
    expect(getChatNotificationId('-100123')).toBe(getChatNotificationId('-100123'));
    expect(getChatNotificationId('-100123')).not.toBe(getChatNotificationId('-100124'));
    expect(getChatNotificationId('-100123', 1)).not.toBe(getChatNotificationId('-100123', 2));
    expect(Number.isInteger(getChatNotificationId('42'))).toBe(true);
    expect(Math.abs(getChatNotificationId('42'))).toBeLessThan(2 ** 31);
  });

  it('несёт чат, сообщение и слот — по ним нажатие открывает нужное', () => {
    const options = buildNativeNotification({
      chatId: '777', messageId: 15, title: 'Кирилл', body: 'Привет', lines: ['Привет'], newCount: 1,
    });
    expect(options).toMatchObject({ title: 'Кирилл', body: 'Привет', autoCancel: true });
    expect(options.extra).toEqual({ chatId: '777', messageId: 15, slot: 1 });

    const target = parseNotificationTarget({ actionId: 'tap', notification: options as never });
    expect(target).toEqual({ chatId: '777', messageId: 15, slot: 1 });
  });

  it('держит последние сообщения чата, самое новое внизу', () => {
    let lines: string[] = [];
    for (let i = 1; i <= 8; i++) lines = appendChatLine('chat-lines', `сообщение ${i}`);
    expect(lines).toEqual(['сообщение 3', 'сообщение 4', 'сообщение 5', 'сообщение 6', 'сообщение 7',
      'сообщение 8']);
  });

  it('чужие уведомления и действия, кроме нажатия, не открывают чат', () => {
    expect(parseNotificationTarget({ actionId: 'tap', notification: { extra: {} } as never })).toBeUndefined();
    expect(parseNotificationTarget({
      actionId: 'dismiss', notification: { extra: { chatId: '1' } } as never,
    })).toBeUndefined();
  });
});
