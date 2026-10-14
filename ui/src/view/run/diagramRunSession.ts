import type { Diagram } from "core";
import type { CompilationPhaseEvent, CompilationPhaseListener } from "cpp";
import type { ScopeCaptureBoard } from "../scope/scopeCapture.js";
import { PinSample } from "./pinSample.js";
import { GpioInputBlock } from "./gpioInputBlock.js";
import { DiagramConnectionValidator } from "./diagramConnectionValidator.js";
import { CompilationSteps } from "./compilationSteps.js";
import { IntervalSchedule, SimulationClock, type RunningRuntime, type RunningSession, type SessionClock } from "./sessionClock.js";

export type RunPhase = "idle" | "starting" | "running" | "stopping";

export interface DiagramCompilerLike {
  compile(diagram: Diagram, options?: { onPhase?: CompilationPhaseListener }): Promise<Uint8Array>;
}

export interface RunSessionListener {
  phase(phase: RunPhase): void;
  status(status: string): void;
  revision(revision: number): void;
  error?(error: string | undefined): void;
  progress?(progress: CompilationSteps): void;
}

/** Compiles the open diagram, runs it, and feeds scope pins into the capture board. */
export class DiagramRunSession {
  private token = 0;
  private wasmSession: RunningSession | undefined;
  private runtime: RunningRuntime | undefined;
  private clock: SessionClock | undefined;
  private phaseValue: RunPhase = "idle";
  private statusValue = "";
  private revisionValue = 0;
  private errorValue: string | undefined;
  private progressValue = CompilationSteps.initial();
  private readonly gpioValues = new Map<string, Map<number, boolean>>();
  private readonly blockIndexes = new Map<string, number>();

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

  progress(): CompilationSteps {
    return this.progressValue;
  }

  gpioValue(blockId: string, pinIndex: number): boolean {
    return this.gpioValues.get(blockId)?.get(pinIndex) ?? false;
  }

  async setGpio(blockId: string, pinIndex: number, value: boolean): Promise<void> {
    const session = this.wasmSession;
    const block = this.diagram.getBlock(blockId);
    const index = this.blockIndexes.get(blockId);
    if (this.phaseValue !== "running" || !session || index === undefined || !block) return;
    const pins = GpioInputBlock.of(block)?.pins;
    if (!pins || !Number.isInteger(pinIndex) || pinIndex < 0 || pinIndex >= pins.length) return;
    const token = this.token;
    const values = this.gpioValues.get(blockId) ?? new Map<number, boolean>();
    values.set(pinIndex, value);
    this.gpioValues.set(blockId, values);
    this.publish();
    try {
      await session.emitGpioIn(index, pinIndex, value);
    } catch (error) {
      if (token === this.token) await this.fail(error);
    }
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
    this.setProgress(CompilationSteps.initial());
    this.setPhase("starting");
    this.gpioValues.clear();
    this.blockIndexes.clear();
    this.diagram.getBlocks().forEach((block, index) => this.blockIndexes.set(block.id, index));
    this.setStatus("Compiling");
    let runtime: RunningRuntime | undefined;
    try {
      new DiagramConnectionValidator().validate(this.diagram);
      this.noteProgress({ phase: "awaiting-modules", status: "active" });
      this.board.prepare(this.diagram);
      const compiler = await this.compiler();
      if (token !== this.token) return;
      const wasm = await compiler.compile(this.diagram, { onPhase: (event) => {
        if (token === this.token) this.noteProgress(event);
      } });
      if (token !== this.token) return;
      this.noteProgress({ phase: "running", status: "active" });
      runtime = this.openRuntime((message) => {
        if (token === this.token) this.note(message);
      });
      const session = await runtime.instantiate(wasm);
      if (token !== this.token) {
        await this.shutdown(session, runtime);
        return;
      }
      this.wasmSession = session;
      this.runtime = runtime;
      runtime = undefined;
      // Give every browser input the Off state displayed by its switch.
      for (const block of this.diagram.getBlocks()) {
        const gpio = GpioInputBlock.of(block);
        if (!gpio) continue;
        for (let pin = 0; pin < gpio.pins.length; pin++) {
          if (token !== this.token) return;
          await session.emitGpioIn(this.blockIndexes.get(block.id)!, pin, false);
        }
      }
      const period = await IntervalSchedule.milliseconds(session) ?? this.board.samplingPeriod();
      if (token !== this.token) return;
      if (period !== undefined) {
        const onTick = () => {
          if (token !== this.token) return;
          if (this.board.sample(period)) this.publish();
        };
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
      this.noteProgress({ phase: "running", status: "completed" });
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
    this.gpioValues.clear();
    this.blockIndexes.clear();
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

  private setProgress(progress: CompilationSteps): void {
    this.progressValue = progress;
    this.listener?.progress?.(progress);
  }

  private noteProgress(event: CompilationPhaseEvent): void {
    this.setProgress(this.progressValue.withEvent(event));
  }

  private async fail(error: unknown): Promise<void> {
    const message = messageOf(error);
    this.setStatus(message);
    this.setProgress(this.progressValue.failed());
    this.setError(message);
    await this.stop();
  }

  private note(message: unknown): void {
    const sample = PinSample.read(message);
    if (!sample) return;
    this.board.accept(sample.blockIndex, sample.channel, sample.value);
  }

  private publish(): void {
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
