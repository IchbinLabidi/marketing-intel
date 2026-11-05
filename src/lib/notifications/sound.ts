// A short two-note chime for live notifications, generated with Web Audio (no audio file to load).
// Browsers only allow sound after the person has interacted with the page, so primeNotificationSound() is
// called on the first click/key press to unlock the audio context.

const STORAGE_KEY = "orix.notificationSound";
let ctx: AudioContext | null = null;
let lastPlayed = 0;

function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return null;
    ctx ??= new Ctor();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

export function primeNotificationSound() {
  audio();
}

export function notificationSoundEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

const listeners = new Set<() => void>();

/** For useSyncExternalStore: re-render toggles when the choice changes. */
export function subscribeNotificationSound(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

export function setNotificationSoundEnabled(on: boolean) {
  try {
    window.localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
  } catch {
    /* private mode: the choice lasts for this page only */
  }
  listeners.forEach((l) => l());
}

/** Plays the chime, at most once every few seconds so a burst of changes doesn't ring repeatedly. */
export function playNotificationSound({ force = false } = {}) {
  if (!force && !notificationSoundEnabled()) return;
  const now = Date.now();
  if (!force && now - lastPlayed < 4000) return;
  const ac = audio();
  if (!ac) return;
  lastPlayed = now;
  const start = ac.currentTime + 0.01;
  for (const [freq, delay] of [[880, 0], [1318.5, 0.13]] as const) {
    const osc = ac.createOscillator();
    const gain = ac.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, start + delay);
    gain.gain.exponentialRampToValueAtTime(0.22, start + delay + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + delay + 0.5);
    osc.connect(gain).connect(ac.destination);
    osc.start(start + delay);
    osc.stop(start + delay + 0.55);
  }
}
