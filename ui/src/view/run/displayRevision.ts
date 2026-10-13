/** Coalesces display notifications while sampling continues at its configured precision. */
export class DisplayRevision {
  private latest = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly publish: (revision: number) => void) {}

  update(revision: number): void {
    this.latest = revision;
    this.timer ??= setTimeout(() => this.flush(), 1000 / 30);
  }

  flush(): void {
    if (this.timer === undefined) return;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.publish(this.latest);
  }
}
