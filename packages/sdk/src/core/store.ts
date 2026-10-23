/** A tiny observable value: what the UI elements subscribe to instead of a state library. */
export class Store<T extends object> {
  private listeners = new Set<(state: T) => void>();
  constructor(private state: T) {}

  get(): T { return this.state; }

  set(patch: Partial<T>): void {
    this.state = { ...this.state, ...patch };
    for (const l of this.listeners) l(this.state);
  }

  subscribe(listener: (state: T) => void): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
}
