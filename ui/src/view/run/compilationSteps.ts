import type { CompilationPhase, CompilationPhaseEvent } from "cpp";

export type CompilationStepStatus = "pending" | "active" | "completed" | "failed";

export class CompilationStep {
  constructor(readonly phase: CompilationPhase, readonly label: string, readonly status: CompilationStepStatus = "pending") {}
}

/** Immutable progress snapshot; a successful operation checks its own step. */
export class CompilationSteps {
  private constructor(readonly items: readonly CompilationStep[]) {}

  static initial(): CompilationSteps {
    return new CompilationSteps([
      new CompilationStep("awaiting-modules", "Awaiting modules"),
      new CompilationStep("compilation", "Compilation"),
      new CompilationStep("linking", "Linking"),
      new CompilationStep("running", "Running"),
    ]);
  }

  withEvent(event: CompilationPhaseEvent): CompilationSteps {
    return new CompilationSteps(this.items.map((step) => step.phase === event.phase
      ? new CompilationStep(step.phase, step.label, event.status) : step));
  }

  failed(): CompilationSteps {
    return new CompilationSteps(this.items.map((step) => step.status === "active"
      ? new CompilationStep(step.phase, step.label, "failed") : step));
  }
}
