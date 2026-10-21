// Entry point: fonts and styles, the screens, then the game (app/createGame.js).

// Vazirmatn is bundled with the site (no Google Fonts request, which can be slow or blocked)
import '@fontsource/vazirmatn/300.css';
import '@fontsource/vazirmatn/400.css';
import '@fontsource/vazirmatn/600.css';
import '@fontsource/vazirmatn/800.css';
import './ui/style.css';
import { UI } from './ui/UI.js';
import { createGame } from './app/createGame.js';

const ui = new UI();
ui.bind();

createGame({ ui, debug: new URLSearchParams(location.search).has('debug') }).catch((e) => {
  console.error(e);
  ui.setLoading(1, 'خطا در ساخت صحنه: ' + e.message);
});
