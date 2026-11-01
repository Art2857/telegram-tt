# Иконка Proxygram (временная)

Временная иконка без мотивов Telegram (правила API, PLAN.md 4): облачко сообщения со стрелками ⇄ — знак прокси-чата (PLAN.md 7.7). Финальную иконку выбирает владелец (PLAN.md 18, OWNER-TODO).

- `icon.svg` — основная (круг): favicon, иконки PWA и приложения;
- `icon-square.svg` — без скругления, для `icon-square-*` (iOS сам скругляет углы);
- `favicon-unread.svg` — с точкой непрочитанного;
- `tray-macos.svg` — одноцветная иконка трея macOS.

Скрипт кладёт иконку и на экран входа (`src/assets/telegram-logo.svg`: имя файла как в Web A).

Пересобрать растровые версии:

```bash
node branding/generate-icons.mjs
```
