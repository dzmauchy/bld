import type { Diagram } from "core";
import { createSignal, type Accessor } from "solid-js";
import type { ScopeCaptureBoard } from "../scope/scopeCapture.js";
import {
  DiagramRunSession,
  type DiagramCompilerLike,
  type RunPhase,
  type RunSessionListener,
} from "./diagramRunSession.js";
import type { RunningRuntime, RunningSession, SessionClock } from "./sessionClock.js";

export type { DiagramCompilerLike, RunPhase };

/** Solid view of a diagram run. The button reads these signals. */
export class DiagramRunController {
  readonly phase: Accessor<RunPhase>;
  readonly status: Accessor<string>;
  readonly revision: Accessor<number>;
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
    const phase = createSignal<RunPhase>("idle");
    const status = createSignal("");
    const revision = createSignal(0);
    this.phase = phase[0];
    this.status = status[0];
    this.revision = revision[0];
    const listener: RunSessionListener = {
      phase: phase[1],
      status: status[1],
      revision: revision[1],
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
