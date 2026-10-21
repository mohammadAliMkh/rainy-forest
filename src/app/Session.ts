import { FIRE } from '../config/config.js';
import { EV } from '../config/events.ts';
import type { GameEvents } from '../config/events.ts';
import type { EventBus } from '../engine/events.ts';
import type { FrameBase } from '../engine/Game.ts';
import type { QualityManager } from '../engine/quality/QualityManager.ts';
import type { PlayerController } from '../game/player/PlayerController.ts';
import type { Camp } from '../game/camp/Camp.js';
import type { Soundscape } from '../game/sound/Soundscape.ts';
import type { UI } from '../ui/UI.js';
import type { Minimap } from '../ui/Minimap.js';
import { TouchControls, isTouchFirst } from '../ui/TouchControls.js';

interface SessionParts {
  ui: UI;
  events: EventBus<GameEvents>;
  player: PlayerController;
  camp: Camp;
  sound: Soundscape;
  quality: QualityManager;
  minimap: Minimap;
  canvas: HTMLCanvasElement;
}

// screen.orientation.lock() exists on Android browsers but not in the DOM types
type LockableOrientation = ScreenOrientation & { lock?: (o: 'landscape') => Promise<void> };

// The flow of a visit, between the screens and the game: entering the
// forest, the settings menu (Esc / the gear button), the introductions
// taking over the view, keys that act on the whole game, pausing the sound
// in a hidden tab, and which on-screen parts (touch controls, map) show.

export class Session {
  /** the player has clicked "enter the forest" */
  entered = false;
  readonly touch: TouchControls;
  private ui: UI;
  private player: PlayerController;
  private camp: Camp;
  private sound: Soundscape;
  private minimap: Minimap;
  private _waitHintAt = 0;

  constructor({ ui, events, player, camp, sound, quality, minimap, canvas }: SessionParts) {
    this.ui = ui;
    this.player = player;
    this.camp = camp;
    this.sound = sound;
    this.minimap = minimap;

    // phones / tablets: joystick + drag-to-look + buttons instead of keys & mouse
    const touch = new TouchControls(player, canvas, { onMenu: () => this.openMenu() });
    touch.onEnable = () => { if (this.entered && !this.menuOpen() && !camp.intro.active) touch.show(true); };
    this.touch = touch;

    // the introductions take over the camera like a film scene
    events.on(EV.INTRO_CINEMATIC, (on) => {
      player.freeMode = !on && !this.menuOpen();
      player.keys.clear();
      if (!this.menuOpen()) touch.show(!on);
      ui.setCinema(on);
      this.showMap();
    });
    events.on(EV.INTRO_CAPTION, (name) => ui.setCaption(name));
    events.on(EV.INTRO_SUBTITLE, (text) => ui.setSubtitle(text));
    events.on(EV.INTRO_FADE, (a) => ui.setFade(a));
    ui.on('skip', () => camp.intro.skip());

    // automatic quality: adapt only while playing; the menu shows the level it picked
    quality.active = () => this.entered && !this.menuOpen() && !document.hidden;
    events.on(EV.QUALITY_CHANGED, ({ name, auto }) => { if (auto) ui.setAutoQualityLabel(name); });

    ui.on('minimap', () => this.showMap());
    ui.on('enter', () => this.enter());
    ui.on('resume', () => this.closeMenu());
    ui.on('replayIntro', () => {
      camp.intro.done = false; // plays again (now if near the fire, else on the way there)
      this.closeMenu();
    });
    // pause the sound while the tab is hidden
    document.addEventListener('visibilitychange', () => {
      const ctx = sound.engine.ctx;
      if (!ctx) return;
      if (document.hidden) ctx.suspend?.();
      else if (this.entered) ctx.resume?.();
    });
    window.addEventListener('keydown', (e) => this._onKey(e));
    if (isTouchFirst()) touch.enable();
  }

  menuOpen(): boolean { return this.ui.isMenuOpen(); }

  openMenu(): void {
    const { player } = this;
    player.freeMode = false;
    player.keys.clear();
    this.touch.show(false);
    this.ui.showPause('');
  }

  closeMenu(): void {
    this.ui.hidePause();
    this.player.freeMode = !this.camp.intro.active;
    this.touch.show(!this.camp.intro.active);
  }

  showMap(): void {
    this.minimap.setVisible(this.entered && this.ui.settings.minimap && !this.camp.intro.active);
  }

  enter(): void {
    if (this.entered) return;
    const { ui, sound, touch } = this;
    // the audio context is created inside this click; the recordings load in
    // the background, so the forest opens right away
    sound.start().catch((e: unknown) => {
      console.warn('Audio failed to start', e);
      sound.engine.filesLoaded = true; // no sound: the introductions must not wait forever
    });
    this.entered = true;
    ui.hideStart();
    this.showMap();
    this.player.freeMode = true;
    if (touch.enabled) {
      // full screen + landscape where the browser allows it (not on iPhone)
      touch.show(true);
      const fs = document.documentElement.requestFullscreen?.({ navigationUI: 'hide' });
      Promise.resolve(fs).then(() => (screen.orientation as LockableOrientation | undefined)?.lock?.('landscape')).catch(() => { /* not allowed / supported */ });
      setTimeout(() => ui.toast('حرکت: دایره پایین سمت چپ · نگاه: انگشت را روی صفحه بکشید', 6000), 900);
    } else {
      setTimeout(() => ui.toast('نگاه: بردن موس به لبه تصویر، یا نگه‌داشتن کلیک راست و کشیدن · تنظیمات: Esc', 6000), 900);
    }
  }

  private _onKey(e: KeyboardEvent): void {
    if (!this.entered) return;
    const intro = this.camp.intro;
    // during the introductions Esc / Space / Enter skip them
    if (intro.active && !this.menuOpen() && ['Escape', 'Space', 'Enter'].includes(e.code)) {
      e.preventDefault();
      intro.skip();
      return;
    }
    // Esc opens / closes the settings menu
    if (e.code !== 'Escape') return;
    if (!this.menuOpen()) this.openMenu();
    else this.closeMenu();
  }

  /** system: a hint while the recordings are still loading at the fire */
  update(frame: FrameBase & { camera: { position: { x: number; z: number } } }): void {
    if (!this.entered || this.camp.intro.done || this.sound.engine.filesLoaded || frame.time <= this._waitHintAt) return;
    const cam = frame.camera.position;
    if (Math.hypot(cam.x - FIRE.x, cam.z - FIRE.z) < 5.2) {
      this.ui.toast('صداها در حال آماده شدن‌اند…', 2500);
      this._waitHintAt = frame.time + 6;
    }
  }
}
