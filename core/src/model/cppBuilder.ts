/**
 * @title C++ Diagram Builder
 *
 * Emits C++ sources for a diagram that instantiate the base library and
 * delegate wasm compilation to the `cpp` package.
 */
import type { Diagram } from "./diagram";
import type { DiagramBlock } from "./diagramBlock";
import type { Connection } from "./connection";
import {
  defaultCppBlockCatalog,
  type CppBlockBinding,
  type CppBlockCatalog,
  type CppCtorArg,
} from "./cppBlockCatalog";

export abstract class DiagramSourceBuilder {
  abstract build(diagram: Diagram): Map<string, string>;
}

export interface ICppCompiler {
  compile(files: Map<string, string>): Promise<Uint8Array>;
}

type PlannedBlock = {
  block: DiagramBlock;
  numericId: number;
  ident: string;
  binding: CppBlockBinding;
};

export class CppDiagramBuilder extends DiagramSourceBuilder {
  constructor(
    private readonly libraryFiles: Record<string, string>,
    private readonly catalog: CppBlockCatalog = defaultCppBlockCatalog,
  ) {
    super();
  }

  override build(diagram: Diagram): Map<string, string> {
    const files = new Map<string, string>();
    for (const [name, content] of Object.entries(this.libraryFiles)) {
      files.set(name === "wasm_host.cpp" ? "wasm_host.inc" : name, content);
    }
    files.set("diagram.cpp", this.emitDiagram(diagram));
    return files;
  }

  emitDiagram(diagram: Diagram): string {
    const planned = this.plan(diagram);
    const connections = diagram.getConnections();
    const applyOrder = this.applyOrder(planned, connections);
    const lines: string[] = [
      "#include <base.hpp>",
      "#include \"wasm_host.hpp\"",
      "#include \"wasm_host.inc\"",
      "",
      "extern \"C\" void build_diagram() {",
    ];

    for (const item of planned) {
      lines.push(`  ${this.emitConstruct(item)};`);
    }
    lines.push("");
    for (const item of applyOrder) {
      lines.push(...this.emitApply(item, planned, connections).map((line) => `  ${line}`));
    }
    lines.push("}");
    lines.push("");
    return lines.join("\n");
  }

  private plan(diagram: Diagram): PlannedBlock[] {
    return diagram.getBlocks().map((block, index) => ({
      block,
      numericId: index,
      ident: cppIdent(block.id),
      binding: this.catalog.require(block.ref),
    }));
  }

  private applyOrder(planned: PlannedBlock[], connections: Connection[]): PlannedBlock[] {
    const byId = new Map(planned.map((item) => [item.block.id, item]));
    const indegree = new Map(planned.map((item) => [item.block.id, 0]));
    const dependents = new Map(planned.map((item) => [item.block.id, [] as string[]]));

    for (const connection of connections) {
      const from = connection.from.blockId;
      const to = connection.to.blockId;
      dependents.get(to)?.push(from);
      indegree.set(from, (indegree.get(from) ?? 0) + 1);
    }

    const queue = planned.filter((item) => (indegree.get(item.block.id) ?? 0) === 0).map((item) => item.block.id);
    const ordered: PlannedBlock[] = [];
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined) break;
      const item = byId.get(id);
      if (!item) continue;
      ordered.push(item);
      for (const next of dependents.get(id) ?? []) {
        const remaining = (indegree.get(next) ?? 0) - 1;
        indegree.set(next, remaining);
        if (remaining === 0) queue.push(next);
      }
    }
    if (ordered.length !== planned.length) {
      throw new Error("Diagram has a cycle and cannot be emitted as C++");
    }
    return ordered;
  }

  private emitConstruct(item: PlannedBlock): string {
    const args = [u32Lit(item.numericId), ...item.binding.ctorArgs.map((arg) => this.formatArg(item.block.getAllConf(), arg))];
    return `auto* ${item.ident} = new ${item.binding.cppClass}(${args.join(", ")})`;
  }

  private emitApply(item: PlannedBlock, planned: PlannedBlock[], connections: Connection[]): string[] {
    const downstream = this.downstreamExprs(item, planned, connections);
    const incoming = this.maxIncomingIndex(item.block.id, connections);
    switch (item.binding.kind) {
      case "sink": {
        const width = Math.max(1, incoming + 1);
        return [`auto ${item.ident}_in = ${item.ident}->apply()(${u8Lit(width)});`];
      }
      case "unary":
        return [`auto ${item.ident}_in = ${item.ident}->apply({${downstream.join(", ")}});`];
      case "aggregate": {
        const width = Math.max(1, incoming + 1);
        return [
          `auto ${item.ident}_out = ${item.ident}->apply({${downstream.join(", ")}});`,
          `auto ${item.ident}_in = ${item.ident}_out(${u8Lit(width)});`,
        ];
      }
      case "source":
        return [`${item.ident}->apply({${downstream.join(", ")}});`];
      case "gpio": {
        const pinGroups = this.gpioPinGroups(item, planned, connections);
        const conf = item.block.getAllConf();
        const port = numberConf(conf, "port", 0);
        const pins = pinsConf(conf);
        return [
          `${item.ident}->apply({${pinGroups.join(", ")}});`,
          `register_gpio_block(${u32Lit(item.numericId)}, ${u16Lit(port)}, Array<u8>{${pins.map((pin) => String(pin)).join(", ")}});`,
        ];
      }
    }
  }

  private downstreamExprs(item: PlannedBlock, planned: PlannedBlock[], connections: Connection[]): string[] {
    const byId = new Map(planned.map((entry) => [entry.block.id, entry]));
    const exprs: string[] = [];
    for (const connection of connections) {
      if (connection.from.blockId !== item.block.id) continue;
      if (item.binding.kind === "gpio") continue;
      const target = byId.get(connection.to.blockId);
      if (!target) continue;
      exprs.push(this.consumerExpr(target, connection.to.vectorIndex));
    }
    return exprs;
  }

  private gpioPinGroups(item: PlannedBlock, planned: PlannedBlock[], connections: Connection[]): string[] {
    const byId = new Map(planned.map((entry) => [entry.block.id, entry]));
    const pins = pinsConf(item.block.getAllConf());
    const groups: string[][] = pins.map(() => []);
    for (const connection of connections) {
      if (connection.from.blockId !== item.block.id) continue;
      const target = byId.get(connection.to.blockId);
      if (!target) continue;
      const pinIndex = connection.from.vectorIndex;
      while (groups.length <= pinIndex) groups.push([]);
      groups[pinIndex]?.push(this.consumerExpr(target, connection.to.vectorIndex));
    }
    return groups.map((group) => `{${group.join(", ")}}`);
  }

  private consumerExpr(target: PlannedBlock, vectorIndex: number): string {
    if (target.binding.kind === "unary") return `${target.ident}_in`;
    return `${target.ident}_in[${vectorIndex}]`;
  }

  private maxIncomingIndex(blockId: string, connections: Connection[]): number {
    return connections.reduce((max, connection) => {
      if (connection.to.blockId !== blockId) return max;
      return Math.max(max, connection.to.vectorIndex);
    }, -1);
  }

  private formatArg(conf: Record<string, unknown>, arg: CppCtorArg): string {
    switch (arg.type) {
      case "u32":
        return u32Lit(numberConf(conf, arg.key, Number(arg.fallback)));
      case "u16":
        return u16Lit(numberConf(conf, arg.key, Number(arg.fallback)));
      case "f32":
        return f32Lit(numberConf(conf, arg.key, Number(arg.fallback)));
      case "u8[]":
        return `Array<u8>{${pinsConf(conf).join(", ")}}`;
    }
  }
}

export function cppIdent(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `b_${cleaned}`;
}

function numberConf(conf: Record<string, unknown>, key: string, fallback: number): number {
  const value = conf[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function pinsConf(conf: Record<string, unknown>): number[] {
  const raw = conf.pins;
  if (Array.isArray(raw) && raw.length > 0) return raw.map((pin) => Number(pin));
  return [0];
}

function u32Lit(value: number): string {
  return `${Math.trunc(value)}u`;
}

function u16Lit(value: number): string {
  return String(Math.trunc(value));
}

function u8Lit(value: number): string {
  return `static_cast<u8>(${Math.trunc(value)})`;
}

function f32Lit(value: number): string {
  if (Object.is(value, -0)) return "-0.f";
  if (Number.isInteger(value)) return `${value}.f`;
  return `${value}f`;
}
