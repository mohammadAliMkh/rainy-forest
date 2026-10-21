// A small publish / subscribe bus (the event names live in config/events.js).

export class EventBus {
  constructor() {
    this.listeners = new Map();
  }

  // listen to an event; returns a function that stops listening
  on(type, fn) {
    let set = this.listeners.get(type);
    if (!set) this.listeners.set(type, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }

  once(type, fn) {
    const off = this.on(type, (payload) => { off(); fn(payload); });
    return off;
  }

  emit(type, payload) {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const fn of [...set]) fn(payload);
  }
}
