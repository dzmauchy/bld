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

export type { DiagramCompilerLike, RunPhase };

/** Reactive view of a diagram run. The button reads these signals. */
export class DiagramRunController {
  readonly phase: () => RunPhase;
  readonly status: () => string;
  readonly revision: () => number;
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
    this.phase = () => phase.get();
    this.status = () => status.get();
    this.revision = () => revision.get();
    const listener: RunSessionListener = {
      phase: (value) => phase.set(value),
      status: (value) => status.set(value),
      revision: (value) => revision.set(value),
    };
    this.session = new DiagramRunSession(diagram, board, compiler, openRuntime, listener, openClock);
  }

  toggle(): Promise<void> {
    return this.session.toggle();
  }

  stop(): Promise<void> {
    return this.session.stop();
  }
}
