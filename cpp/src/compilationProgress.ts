export type CompilationPhase = "awaiting-modules" | "compilation" | "linking" | "running";
export type CompilationPhaseStatus = "active" | "completed";

export interface CompilationPhaseEvent {
  readonly phase: CompilationPhase;
  readonly status: CompilationPhaseStatus;
}

export type CompilationPhaseListener = (event: CompilationPhaseEvent) => void;

/** Shared listener contract for source builders and compiler implementations. */
export class CompilationProgressEmitter {
  private readonly phaseListeners = new Set<CompilationPhaseListener>();

  addPhaseListener(listener: CompilationPhaseListener): () => void {
    this.phaseListeners.add(listener);
    return () => this.removePhaseListener(listener);
  }

  removePhaseListener(listener: CompilationPhaseListener): void {
    this.phaseListeners.delete(listener);
  }

  protected notifyPhase(event: CompilationPhaseEvent, listener?: CompilationPhaseListener): void {
    for (const registered of this.phaseListeners) registered(event);
    if (listener && !this.phaseListeners.has(listener)) listener(event);
  }
}
