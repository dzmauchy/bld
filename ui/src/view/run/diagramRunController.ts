import type { Diagram } from "core";
import { signal } from "@lit-labs/signals";
import type { ScopeCaptureBoard } from "../scope/scopeCapture.js";
import {
  DiagramRunSession,
  type DiagramCompilerLike,
  type RunPhase,
  type RunSessionListener,
} from "./diagramRunSession.js";
import type { RunningRuntime, RunningSession, SessionClock } from "./sessionClock.js";
import { CompilationSteps } from "./compilationSteps.js";
import { DisplayRevision } from "./displayRevision.js";

export type { DiagramCompilerLike, RunPhase };

/** Reactive view of a diagram run. The button reads these signals. */
export class DiagramRunController {
  readonly phase: () => RunPhase;
  readonly status: () => string;
  readonly revision: () => number;
  readonly error: () => string | undefined;
  readonly progress: () => CompilationSteps;
  private readonly session: DiagramRunSession;

  constructor(
    diagram: Diagram,
    board: ScopeCaptureBoard,
    compiler: () => DiagramCompilerLike | Promise<DiagramCompilerLike>,
    openRuntime: (onHostMessage: (message: unknown) => void) => RunningRuntime,
    openClock?: (
      session: RunningSession,
      periodMs: number,
      onTick: () => void,
      onError: (error: unknown) => void,
    ) => SessionClock,
  ) {
    const phase = signal<RunPhase>("idle");
    const status = signal("");
    const revision = signal(0);
    const error = signal<string | undefined>(undefined);
    const progress = signal(CompilationSteps.initial());
    const display = new DisplayRevision(value => revision.set(value));
    this.phase = () => phase.get();
    this.status = () => status.get();
    this.revision = () => revision.get();
    this.error = () => error.get();
    this.progress = () => progress.get();
    const listener: RunSessionListener = {
      phase: (value) => {
        if (value === "idle" || value === "stopping") display.flush();
        phase.set(value);
      },
      status: (value) => status.set(value),
      revision: (value) => display.update(value),
      error: (value) => error.set(value),
      progress: (value) => progress.set(value),
    };
    this.session = new DiagramRunSession(diagram, board, compiler, openRuntime, listener, openClock);
  }

  toggle(): Promise<void> {
    return this.session.toggle();
  }

  stop(): Promise<void> {
    return this.session.stop();
  }

  gpioValue(blockId: string, pinIndex: number): boolean {
    this.phase();
    this.revision();
    return this.session.gpioValue(blockId, pinIndex);
  }

  setGpio(blockId: string, pinIndex: number, value: boolean): Promise<void> {
    return this.session.setGpio(blockId, pinIndex, value);
  }

  dismissError(): void {
    this.session.dismissError();
  }
}
