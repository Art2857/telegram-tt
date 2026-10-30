// PXG: файл настройки vitest, на который ссылается vitest.config.ts (в апстриме его нет в репозитории)

// jsdom не реализует matchMedia, а модули окружения обращаются к нему при импорте
if (!window.matchMedia) {
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    // eslint-disable-next-line no-null/no-null -- так требует тип MediaQueryList
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  });
}
