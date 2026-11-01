// Растровые иконки веб-клиента и приложения Tauri из SVG в branding/ (см. README.md)
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const branding = join(root, 'branding');
const publicDir = join(root, 'public');
const tauriIcons = join(root, 'tauri', 'icons');

function render(svg, pngSizes) {
  const out = mkdtempSync(join(tmpdir(), 'pxg-icons-'));
  const args = [join(root, 'node_modules', '@tauri-apps', 'cli', 'tauri.js'), 'icon', join(branding, svg), '-o', out];
  if (pngSizes) args.push('--png', pngSizes.join(','));
  execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  return out;
}

function copy(from, files) {
  for (const [source, ...targets] of files) {
    for (const target of targets) copyFileSync(join(from, source), target);
  }
}

const app = render('icon.svg');
const appFiles = ['32x32.png', '64x64.png', '128x128.png', '128x128@2x.png', 'icon.icns', 'icon.ico', 'icon.png'];
copy(app, appFiles.map((file) => [file, join(tauriIcons, file), join(tauriIcons, 'macos', file)]));
copy(app, [['icon.ico', join(publicDir, 'favicon.ico')]]);

const web = render('icon.svg', [16, 32, 180, 192, 384, 512]);
copy(web, [
  ['16x16.png', join(publicDir, 'favicon-16x16.png')],
  ['32x32.png', join(publicDir, 'favicon-32x32.png')],
  ['180x180.png', join(publicDir, 'apple-touch-icon.png'), join(publicDir, 'apple-touch-icon-dev.png')],
  ...[192, 384, 512].map((size) => [
    `${size}x${size}.png`,
    join(publicDir, `icon-${size}x${size}.png`),
    join(publicDir, `icon-dev-${size}x${size}.png`),
  ]),
  ['512x512.png', join(publicDir, 'icon-electron-macos.png')],
]);

const square = render('icon-square.svg', [192, 384, 512]);
copy(square, [192, 384, 512].map((size) => [
  `${size}x${size}.png`,
  join(publicDir, `icon-square-${size}x${size}.png`),
  join(publicDir, `icon-square-dev-${size}x${size}.png`),
]));

const tray = render('tray-macos.svg', [32]);
copy(tray, [['32x32.png', join(tauriIcons, 'tray-macos.png')]]);

copyFileSync(join(branding, 'icon.svg'), join(publicDir, 'favicon.svg'));
// Логотип экрана входа; имя файла — как в Web A, чтобы не расходиться с ним при вливании
copyFileSync(join(branding, 'icon.svg'), join(root, 'src', 'assets', 'telegram-logo.svg'));
copyFileSync(join(branding, 'favicon-unread.svg'), join(publicDir, 'favicon-unread.svg'));

for (const dir of [app, web, square, tray]) rmSync(dir, { recursive: true, force: true });
