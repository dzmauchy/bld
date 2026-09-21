/**
 * @title C++ Diagram Builder
 *
 * Emits C++ sources for a diagram that instantiate the base library.
 * Constructor argument types and apply wiring come from clang++ AST dumps.
 */
import type { Diagram } from "./diagram";
import type { DiagramBlock } from "./diagramBlock";
import type { Connection } from "./connection";
import {
  BlockPortTopology,
  CppBlockCatalog,
  CppTypeNames,
  defaultCppBlockCatalog,
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
  topology: BlockPortTopology;
  streamCppType: string;
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
      "using push::f32::F32;",
      "",
      "extern \"C\" void build_diagram() {",
    ];

    for (const item of planned) {
      lines.push(...this.emitConstruct(item).map((line) => `  ${line}`));
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
    const catalog = this.catalogFor(diagram);
    return diagram.getBlocks().map((block, index) => {
      if (!block.definition.cppClass) throw new Error(`Unknown C++ block "${block.ref}"`);
      const topology = catalog.topology(block.ref, block.getAllConf());
      return {
        block,
        numericId: index,
        ident: cppIdent(block.id),
        topology,
        streamCppType: topology.streamCppType(),
      };
    });
  }

  private catalogFor(diagram: Diagram): CppBlockCatalog {
    return this.catalog.palette.getBlocks().length > 0
      ? this.catalog
      : CppBlockCatalog.fromPalette(diagram.palette);
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

  private emitConstruct(item: PlannedBlock): string[] {
    const conf = item.block.getAllConf();
    const args: string[] = [u32Lit(item.numericId)];
    const prefix: string[] = [];
    const ctorParams = item.topology.constructorParameters().slice(1);
    const confProps = [...item.block.definition.config.values()];
    ctorParams.forEach((param, index) => {
      const prop = confProps[index];
      if (!prop) return;
      if (CppTypeNames.isArrayQualType(param.qualType)) {
        const ident = `${item.ident}_${prop.id}`;
        const values = arrayConf(conf, prop.id, prop.defaultValue).map((entry) => String(entry));
        prefix.push(...emitPushArray(ident, param.qualType, values));
        args.push(moveExpr(param.qualType, ident));
      } else {
        args.push(CppTypeNames.literalFromClang(param.qualType, conf[prop.id] ?? prop.defaultValue ?? 0));
      }
    });
    return [...prefix, `auto* ${item.ident} = new ${item.block.definition.cppClass}(${args.join(", ")});`];
  }

  private emitApply(item: PlannedBlock, planned: PlannedBlock[], connections: Connection[]): string[] {
    if (item.topology.registersHostPins()) {
      return this.emitPinBoundApply(item, planned, connections);
    }
    const downstream = this.downstreamExprs(item, planned, connections);
    const incoming = this.maxIncomingIndex(item.block.id, connections);
    const width = Math.max(1, incoming + 1);
    const dn = `${item.ident}_dn`;
    if (item.topology.exposesConsumerBank()) {
      return [`auto ${item.ident}_in = ${item.ident}->apply(${u8Lit(width)});`];
    }
    if (item.topology.returnsScalarConsumer()) {
      return [
        ...emitPushArray(dn, item.streamCppType, downstream),
        `auto ${item.ident}_in = ${item.ident}->apply(${moveExpr(item.streamCppType, dn)});`,
      ];
    }
    if (item.topology.returnsIndexedConsumers()) {
      return [
        ...emitPushArray(dn, item.streamCppType, downstream),
        `auto ${item.ident}_in = ${item.ident}->apply(${moveExpr(item.streamCppType, dn)}, ${u8Lit(width)});`,
      ];
    }
    return [
      ...emitPushArray(dn, item.streamCppType, downstream),
      `${item.ident}->apply(${moveExpr(item.streamCppType, dn)});`,
    ];
  }

  private emitPinBoundApply(item: PlannedBlock, planned: PlannedBlock[], connections: Connection[]): string[] {
    const pinGroups = this.pinGroups(item, planned, connections);
    const conf = item.block.getAllConf();
    const lines: string[] = [];
    pinGroups.forEach((group, index) => {
      const pin = `${item.ident}_p${index}`;
      lines.push(...emitPushArray(pin, item.streamCppType, group));
      lines.push(`${item.ident}->connectPin(${u8Lit(index)}, ${moveExpr(item.streamCppType, pin)});`);
    });
    lines.push(`${item.ident}->apply();`);
    const portProp = item.block.definition.getConfig("port");
    const pinsId = item.topology.pinBindConfId();
    const pinsProp = pinsId ? item.block.definition.getConfig(pinsId) : undefined;
    const ctorParams = item.topology.constructorParameters();
    const portType = ctorParams[1]?.qualType ?? "u16";
    const pinsType = ctorParams[2]?.qualType ?? "Array<u8>";
    if (portProp && pinsProp) {
      const hw = `${item.ident}_hw`;
      const pins = arrayConf(conf, pinsProp.id, pinsProp.defaultValue);
      lines.push(...emitPushArray(hw, pinsType, pins.map((pin) => String(pin))));
      lines.push(
        `register_gpio_block(${u32Lit(item.numericId)}, ${CppTypeNames.literalFromClang(portType, conf[portProp.id] ?? portProp.defaultValue ?? 0)}, ${hw});`,
      );
    }
    return lines;
  }

  private downstreamExprs(item: PlannedBlock, planned: PlannedBlock[], connections: Connection[]): string[] {
    const byId = new Map(planned.map((entry) => [entry.block.id, entry]));
    const exprs: string[] = [];
    for (const connection of connections) {
      if (connection.from.blockId !== item.block.id) continue;
      if (item.topology.registersHostPins()) continue;
      const target = byId.get(connection.to.blockId);
      if (!target) continue;
      exprs.push(this.consumerExpr(target, connection.to.vectorIndex));
    }
    return exprs;
  }

  private pinGroups(item: PlannedBlock, planned: PlannedBlock[], connections: Connection[]): string[][] {
    const byId = new Map(planned.map((entry) => [entry.block.id, entry]));
    const bindId = item.topology.pinBindConfId();
    const pinCount = bindId ? arrayConf(item.block.getAllConf(), bindId, [0]).length : 0;
    const groups: string[][] = Array.from({ length: pinCount }, () => []);
    for (const connection of connections) {
      if (connection.from.blockId !== item.block.id) continue;
      const target = byId.get(connection.to.blockId);
      if (!target) continue;
      const pinIndex = connection.from.vectorIndex;
      while (groups.length <= pinIndex) groups.push([]);
      groups[pinIndex]?.push(this.consumerExpr(target, connection.to.vectorIndex));
    }
    return groups;
  }

  private consumerExpr(target: PlannedBlock, vectorIndex: number): string {
    if (target.topology.returnsScalarConsumer()) return `${target.ident}_in`;
    return `${target.ident}_in[${vectorIndex}]`;
  }

  private maxIncomingIndex(blockId: string, connections: Connection[]): number {
    return connections.reduce((max, connection) => {
      if (connection.to.blockId !== blockId) return max;
      return Math.max(max, connection.to.vectorIndex);
    }, -1);
  }
}

export function cppIdent(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9_]/g, "_");
  return /^[A-Za-z_]/.test(cleaned) ? cleaned : `b_${cleaned}`;
}

function arrayConf(conf: Record<string, unknown>, key: string, fallback: unknown): number[] {
  const raw = conf[key];
  if (Array.isArray(raw) && raw.length > 0) return raw.map((entry) => Number(entry));
  if (Array.isArray(fallback) && fallback.length > 0) return fallback.map((entry) => Number(entry));
  return [0];
}

function u32Lit(value: number): string {
  return `${Math.trunc(value)}u`;
}

function u8Lit(value: number): string {
  return `static_cast<u8>(${Math.trunc(value)})`;
}

function emitPushArray(ident: string, type: string, values: string[]): string[] {
  const lines = [`auto ${ident} = ${type}{};`];
  for (const value of values) {
    lines.push(`${ident}.push_back(${value});`);
  }
  return lines;
}

function moveExpr(type: string, ident: string): string {
  return `static_cast<${type}&&>(${ident})`;
}
