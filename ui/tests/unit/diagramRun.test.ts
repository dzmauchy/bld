import { Diagram, Library, OutputPortEndpoint, InputPortEndpoint, type PackageManifest } from "core";
import { expect, test } from "vitest";
import { DiagramRunSession, type DiagramCompilerLike } from "ui/view/run/diagramRunSession.ts";
import { PinSample } from "ui/view/run/pinSample.ts";
import { IntervalSchedule, SessionClock, type RunningRuntime, type RunningSession } from "ui/view/run/sessionClock.ts";
import { ScopeCaptureBoard } from "ui/view/scope/scopeCapture.ts";
import { ScopePlotGeometry } from "ui/view/scope/scopePlotGeometry.ts";
import type { CompilationPhaseListener } from "cpp";

const manifest: PackageManifest = {
  id: "demo",
  name: "Demo",
  icon: "library-base.svg",
  location: "memory:demo",
};

test("reads pin messages from the wasm host", () => {
  expect(PinSample.read({ type: "pin", blockId: 1, pin: 2, value: 0.25 })).toEqual(new PinSample(1, 2, 0.25));
  expect(PinSample.read({ type: "ok", id: 1 })).toBeUndefined();
  expect(PinSample.read({ type: "pin", blockId: 1.5, pin: 0, value: 1 })).toBeUndefined();
  expect(PinSample.read(null)).toBeUndefined();
});

test("uses the fastest active source interval", async () => {
  const period = await IntervalSchedule.milliseconds({
    activeIntervalCount: async () => 2,
    intervalPeriodAt: async (index) => (index === 0 ? 40 : 10),
  });
  expect(period).toBe(10);
  expect(await IntervalSchedule.milliseconds({
    activeIntervalCount: async () => 0,
    intervalPeriodAt: async () => 0,
  })).toBeUndefined();
});

test("plots every scope output on one time domain and one value range", () => {
  const { diagram, scopeId } = connectedScope();
  const board = new ScopeCaptureBoard();
  board.prepare(diagram);
  const monitor = board.monitorFor(diagram, scopeId);
  expect(monitor?.series().map((series) => series.label)).toEqual(["sin", "cos"]);
  expect(board.accept(0, 0, 0)).toBe(true);
  expect(board.accept(0, 1, 10)).toBe(true);
  expect(monitor?.series()[0]?.buffer.size).toBe(0);
  expect(board.sample(1000)).toBe(true);
  const geometry = ScopePlotGeometry.fromMonitor(monitor!);
  expect(geometry.series).toHaveLength(2);
  expect(geometry.domainSeconds).toBe(2);
  expect(geometry.sampleSeconds).toBe(1);
  expect(geometry.minimum).toBeLessThan(0);
  expect(geometry.maximum).toBeGreaterThan(10);
  const newest = (plot: ScopePlotGeometry) => plot.series.map((series) => plot.sampleTime(series, series.buffer.capacity - 1));
  expect(newest(geometry)).toEqual([2, 2]);
  const oldest = geometry.sampleTime(geometry.series[0]!, 0);
  board.accept(0, 0, 1);
  board.sample(1000);
  const scrolled = ScopePlotGeometry.fromMonitor(monitor!);
  expect(scrolled.axisSeconds).toBe(2);
  expect(scrolled.sampleTime(scrolled.series[0]!, 0)).toBe(oldest);
  expect(scrolled.sampleTime(scrolled.series[0]!, scrolled.series[0]!.buffer.capacity - 1)).toBe(scrolled.axisSeconds);
  expect([scrolled.series[0]!.buffer.at(0), scrolled.series[0]!.buffer.at(1)]).toEqual([0, 1]);
  expect([scrolled.series[1]!.buffer.at(0), scrolled.series[1]!.buffer.at(1)]).toEqual([10, 10]);
  expect(scrolled.series[0]!.buffer).toBe(geometry.series[0]!.buffer);
});

test("runs the diagram, then the run control becomes stop", async () => {
  const { diagram, scopeId } = connectedScope();
  const board = new ScopeCaptureBoard();
  let clock: ManualClock | undefined;
  let compileCount = 0;
  let runtime: FakeRuntime | undefined;
  {
    const runner = new DiagramRunSession(
      diagram,
      board,
      () => ({
        compile: async () => {
          compileCount += 1;
          return new Uint8Array([1]);
        },
      }) satisfies DiagramCompilerLike,
      (onHostMessage) => {
        runtime = new FakeRuntime(onHostMessage);
        return runtime;
      },
      undefined,
      (_session, _period, onTick) => clock = new ManualClock(onTick),
    );
    expect(runner.phase()).toBe("idle");
    const starting = runner.run();
    expect(runner.phase()).toBe("starting");
    await starting;
    expect(runner.phase()).toBe("running");
    expect(compileCount).toBe(1);
    expect(clock?.started).toBe(true);
    expect(runner.revision()).toBe(0);
    clock?.tick(100);
    expect(runner.revision()).toBe(1);
    const geometry = ScopePlotGeometry.fromMonitor(board.monitorFor(diagram, scopeId)!);
    expect(geometry.series.map((series) => series.buffer.last())).toEqual([0.5, -2]);
    expect(geometry.minimum).toBeLessThan(-2);
    expect(geometry.maximum).toBeGreaterThan(0.5);
    await runner.toggle();
    expect(runner.phase()).toBe("idle");
    expect(clock?.started).toBe(false);
    clock?.tick(100);
    expect(runner.revision()).toBe(1);
    expect(runtime?.closed).toBe(true);
    expect(runtime?.session.closed).toBe(true);
  }
});

test("keeps the run control idle when compilation fails", async () => {
  const { diagram } = connectedScope();
  const runtime = new FakeRuntime(() => undefined);
  {
    const runner = new DiagramRunSession(
      diagram,
      new ScopeCaptureBoard(),
      () => ({
        compile: async () => {
          throw new Error("port mismatch");
        },
      }),
      () => runtime,
    );
    await runner.toggle();
    expect(runner.phase()).toBe("idle");
    expect(runner.status()).toBe("port mismatch");
    expect(runner.error()).toBe("port mismatch");
    runner.dismissError();
    expect(runner.error()).toBeUndefined();
    expect(runtime.closed).toBe(false);
  }
});

test("checks successful compilation phases and awaits runtime startup before checking Running", async () => {
  const { diagram } = connectedScope();
  const compiled = Promise.withResolvers<Uint8Array>();
  const compiling = Promise.withResolvers<void>();
  const instantiating = Promise.withResolvers<void>();
  const instantiated = Promise.withResolvers<RunningSession>();
  let report: CompilationPhaseListener = () => undefined;
  const runner = new DiagramRunSession(diagram, new ScopeCaptureBoard(), () => ({
    compile: async (_diagram, options) => {
      report = options!.onPhase!;
      compiling.resolve();
      return compiled.promise;
    },
  }), () => ({
    instantiate: async () => { instantiating.resolve(); return instantiated.promise; },
    close: async () => undefined,
  }), undefined, () => new ManualClock());
  const states = () => runner.progress().items.map(step => step.status);
  const starting = runner.run();
  await compiling.promise;
  expect(states()).toEqual(["active", "pending", "pending", "pending"]);
  report({ phase: "awaiting-modules", status: "completed" });
  report({ phase: "compilation", status: "active" });
  expect(states()).toEqual(["completed", "active", "pending", "pending"]);
  report({ phase: "compilation", status: "completed" });
  report({ phase: "linking", status: "active" });
  expect(states()).toEqual(["completed", "completed", "active", "pending"]);
  report({ phase: "linking", status: "completed" });
  compiled.resolve(new Uint8Array([1]));
  await instantiating.promise;
  expect(states()).toEqual(["completed", "completed", "completed", "active"]);
  expect(runner.phase()).toBe("starting");
  instantiated.resolve(new FakeSession());
  await starting;
  expect(states()).toEqual(["completed", "completed", "completed", "completed"]);
  expect(runner.phase()).toBe("running");
  await runner.stop();
});

test("leaves a failed phase unchecked and ignores progress from a canceled compilation", async () => {
  const { diagram } = connectedScope();
  const compiled = Promise.withResolvers<Uint8Array>();
  const compiling = Promise.withResolvers<void>();
  let report: CompilationPhaseListener = () => undefined;
  const runner = new DiagramRunSession(diagram, new ScopeCaptureBoard(), () => ({
    compile: async (_diagram, options) => {
      report = options!.onPhase!;
      report({ phase: "awaiting-modules", status: "completed" });
      report({ phase: "compilation", status: "active" });
      compiling.resolve();
      return compiled.promise;
    },
  }), () => new FakeRuntime(() => undefined));
  const starting = runner.run();
  await compiling.promise;
  compiled.reject(new Error("clang failed"));
  await starting;
  expect(runner.progress().items.map(step => step.status)).toEqual(["completed", "failed", "pending", "pending"]);
  expect(runner.error()).toBe("clang failed");
  const failed = runner.progress();
  report({ phase: "compilation", status: "completed" });
  expect(runner.progress()).toBe(failed);
});

test("rejects missing connections before invoking the compiler or runtime", async () => {
  const { diagram } = connectedScope();
  diagram.disconnect(diagram.getConnections()[0]!.id);
  let compileCount = 0;
  let runtimeCount = 0;
  const runner = new DiagramRunSession(diagram, new ScopeCaptureBoard(), () => {
    compileCount++;
    return { compile: async () => new Uint8Array([1]) };
  }, () => {
    runtimeCount++;
    return new FakeRuntime(() => undefined);
  });
  await runner.run();
  expect(runner.phase()).toBe("idle");
  expect(runner.error()).toContain("sin: port “downstream” has no connection.");
  expect(compileCount).toBe(0);
  expect(runtimeCount).toBe(0);
});

test("closes the session and runtime when startup fails after instantiation", async () => {
  const { diagram } = connectedScope();
  const session = new FakeSession();
  session.activeIntervalCount = async () => { throw new Error("Interval setup failed"); };
  let runtimeClosed = false;
  const runner = new DiagramRunSession(diagram, new ScopeCaptureBoard(), () => ({
    compile: async () => new Uint8Array([1]),
  }), () => ({
    instantiate: async () => session,
    close: async () => { runtimeClosed = true; },
  }));
  await runner.run();
  expect(runner.phase()).toBe("idle");
  expect(runner.error()).toBe("Interval setup failed");
  expect(session.closed).toBe(true);
  expect(runtimeClosed).toBe(true);
});

class FakeSession implements RunningSession {
  closed = false;
  async setNow(): Promise<number> { return 0; }
  async tick(): Promise<number> { return 0; }
  async close(): Promise<number> {
    this.closed = true;
    return 0;
  }
  async activeIntervalCount(): Promise<number> { return 1; }
  async intervalPeriodAt(): Promise<number> { return 10; }
}

class FakeRuntime implements RunningRuntime {
  readonly session = new FakeSession();
  closed = false;

  constructor(private readonly onHostMessage: (message: unknown) => void) {}

  async instantiate(): Promise<RunningSession> {
    this.onHostMessage({ type: "pin", blockId: 0, pin: 0, value: 0.5 });
    this.onHostMessage({ type: "pin", blockId: 0, pin: 1, value: -2 });
    return this.session;
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class ManualClock extends SessionClock {
  started = false;
  constructor(private readonly onTick: () => void = () => undefined) { super(); }
  override start(): void { this.started = true; }
  override stop(): void { this.started = false; }
  tick(count = 1): void {
    for (let index = 0; index < count && this.started; index++) this.onTick();
  }
}

function connectedScope(): { diagram: Diagram; scopeId: string } {
  const library = Library.fromManifest(manifest, {
    blocks: {
      ScopeF32: {
        ns: ["push", "f32", "sinks"],
        title: "Scope",
        outputs: { channels: { type: "f32", vector: true } },
        conf: {
          period: { type: "u32", default: 2 },
          precision: { type: "u32", default: 1000 },
        },
      },
      SinGenF32: {
        ns: ["push", "f32", "sources"],
        title: "sin",
        inputs: { downstream: { type: "f32", vector: true } },
      },
      CosGenF32: {
        ns: ["push", "f32", "sources"],
        title: "cos",
        inputs: { downstream: { type: "f32", vector: true } },
      },
    },
  });
  const diagram = new Diagram("diagram", "Diagram", library.palette);
  const scope = diagram.addBlock("ScopeF32", { x: 0, y: 0 });
  const sin = diagram.addBlock("SinGenF32", { x: 200, y: 0 });
  const cos = diagram.addBlock("CosGenF32", { x: 200, y: 80 });
  diagram.connect(new OutputPortEndpoint(scope.id, "channels", 0), new InputPortEndpoint(sin.id, "downstream", 0));
  diagram.connect(new OutputPortEndpoint(scope.id, "channels", 1), new InputPortEndpoint(cos.id, "downstream", 0));
  return { diagram, scopeId: scope.id };
}
