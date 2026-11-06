type SystemBarsBridge = { setColor: (color: string, isDark: boolean) => void };

/**
 * The Android app keeps the page clear of the status and navigation bars and paints them itself
 * (`tauri/gen/android/.../MainActivity.kt`): they take the color of the theme, as `theme-color` does in a browser
 */
export function syncAndroidSystemBars() {
  const bridge = (window as { PxgSystemBars?: SystemBarsBridge }).PxgSystemBars;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!bridge || !meta) return;

  const apply = () => {
    const color = expandHexColor(meta.getAttribute('content') || '#ffffff');
    bridge.setColor(color, document.documentElement.classList.contains('theme-dark'));
  };
  apply();
  new MutationObserver(apply).observe(meta, { attributes: true, attributeFilter: ['content'] });
}

/** Android parses only the full `#rrggbb` form, while Web A writes `#fff` */
function expandHexColor(color: string) {
  const short = color.match(/^#([0-9a-f])([0-9a-f])([0-9a-f])$/i);
  return short ? `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}` : color;
}
