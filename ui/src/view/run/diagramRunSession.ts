import type { Diagram } from "core";
import type { ScopeCaptureBoard } from "../scope/scopeCapture.js";
import { PinSample } from "./pinSample.js";
import { DiagramConnectionValidator } from "./diagramConnectionValidator.js";
import { IntervalSchedule, SimulationClock, type RunningRuntime, type RunningSession, type SessionClock } from "./sessionClock.js";

export type RunPhase = "idle" | "starting" | "running" | "stopping";

export interface DiagramCompilerLike {
  compile(diagram: Diagram): Promise<Uint8Array>;
}

export interface RunSessionListener {
  phase(phase: RunPhase): void;
  status(status: string): void;
  revision(revision: number): void;
  error?(error: string | undefined): void;
}

/** Compiles the open diagram, runs it, and feeds scope pins into the capture board. */
export class DiagramRunSession {
  private token = 0;
  private wasmSession: RunningSession | undefined;
  private runtime: RunningRuntime | undefined;
  private clock: SessionClock | undefined;
  private dirty = false;
  private phaseValue: RunPhase = "idle";
  private statusValue = "";
  private revisionValue = 0;
  private errorValue: string | undefined;

  constructor(
    private readonly diagram: Diagram,
    private readonly board: ScopeCaptureBoard,
    private readonly compiler: () => DiagramCompilerLike | Promise<DiagramCompilerLike>,
    private readonly openRuntime: (onHostMessage: (message: unknown) => void) => RunningRuntime,
    private readonly listener?: RunSessionListener,
    private readonly openClock?: (
      session: RunningSession,
      periodMs: number,
      onTick: () => void,
      onError: (error: unknown) => void,
    ) => SessionClock,
  ) {}

  phase(): RunPhase {
    return this.phaseValue;
  }

  status(): string {
    return this.statusValue;
  }

  revision(): number {
    return this.revisionValue;
  }

  error(): string | undefined {
    return this.errorValue;
  }

  dismissError(): void {
    this.setError(undefined);
  }

  async toggle(): Promise<void> {
    if (this.phaseValue === "stopping") return;
    if (this.phaseValue === "idle") await this.run();
    else await this.stop();
  }

  async run(): Promise<void> {
    if (this.phaseValue !== "idle") return;
    const token = ++this.token;
    this.setError(undefined);
    this.setPhase("starting");
    this.setStatus("Compiling");
    let runtime: RunningRuntime | undefined;
    try {
      new DiagramConnectionValidator().validate(this.diagram);
      this.board.prepare(this.diagram);
      const compiler = await this.compiler();
      if (token !== this.token) return;
      const wasm = await compiler.compile(this.diagram);
      if (token !== this.token) return;
      runtime = this.openRuntime((message) => this.note(message));
      const session = await runtime.instantiate(wasm);
      if (token !== this.token) {
        await this.shutdown(session, runtime);
        return;
      }
      this.wasmSession = session;
      this.runtime = runtime;
      runtime = undefined;
      this.publish();
      const period = await IntervalSchedule.milliseconds(session);
      if (token !== this.token) return;
      if (period !== undefined) {
        const onTick = () => this.publish();
        const onError = (error: unknown) => {
          void this.fail(error);
        };
        const clock = this.openClock
          ? this.openClock(session, period, onTick, onError)
          : new SimulationClock(session, period, onTick, onError);
        this.clock = clock;
        clock.start();
      }
      if (token !== this.token) {
        this.clock?.stop();
        return;
      }
      this.setStatus("");
      this.setPhase("running");
    } catch (error) {
      if (runtime) await runtime.close().catch(() => undefined);
      if (token !== this.token) return;
      await this.fail(error);
    }
  }

  async stop(): Promise<void> {
    const token = ++this.token;
    const session = this.wasmSession;
    const runtime = this.runtime;
    const clock = this.clock;
    this.wasmSession = undefined;
    this.runtime = undefined;
    this.clock = undefined;
    this.setPhase("stopping");
    clock?.stop();
    await this.shutdown(session, runtime);
    if (token !== this.token) return;
    if (this.statusValue === "Compiling") this.setStatus("");
    this.setPhase("idle");
  }

  private setPhase(phase: RunPhase): void {
    this.phaseValue = phase;
    this.listener?.phase(phase);
  }

  private setStatus(status: string): void {
    this.statusValue = status;
    this.listener?.status(status);
  }

  private setError(error: string | undefined): void {
    this.errorValue = error;
    this.listener?.error?.(error);
  }

  private async fail(error: unknown): Promise<void> {
    const message = messageOf(error);
    this.setStatus(message);
    this.setError(message);
    await this.stop();
  }

  private note(message: unknown): void {
    const sample = PinSample.read(message);
    if (!sample) return;
    if (this.board.accept(sample.blockIndex, sample.channel, sample.value)) this.dirty = true;
  }

  private publish(): void {
    if (!this.dirty) return;
    this.dirty = false;
    this.revisionValue += 1;
    this.listener?.revision(this.revisionValue);
  }

  private async shutdown(session: RunningSession | undefined, runtime: RunningRuntime | undefined): Promise<void> {
    await session?.close().catch(() => undefined);
    await runtime?.close().catch(() => undefined);
  }
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.trim() || "Diagram failed to run";
}
