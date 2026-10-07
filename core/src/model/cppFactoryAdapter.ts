import type { DiagramBlock } from "./diagramBlock";

/** Copies parameter declarations into an adapter; Clang resolves their types and defaults. */
export class CppFactoryAdapter {
  constructor(private readonly files: Readonly<Record<string, string>>) {}

  name(block: DiagramBlock, index: number): string {
    const scope = block.definition.cppFactory.split("::").slice(0, -1);
    return [...scope, `bld_factory_${index}`].join("::");
  }

  emit(block: DiagramBlock, index: number): string {
    const definition = block.definition;
    const scope = definition.cppFactory.split("::").slice(0, -1).join("::");
    const parameters = this.parameters(definition.cppFactory);
    const config = block.getExplicitConfig();
    for (const id of Object.keys(config)) {
      if (!definition.getConfig(id)) throw new Error(`Unknown configuration property "${id}"`);
    }
    const args = ["blockId"];
    const lines: string[] = [];
    for (const property of definition.config.values()) {
      const value = config[property.id];
      const expression = value === undefined ? `core::detail::move(${property.id})` : this.value(property.id, value);
      const name = `bld_arg_${property.id}`;
      lines.push(`#line 1 "config_${index}_${property.id}"`, `auto ${name} = ${expression};`);
      args.push(`core::detail::move(${name})`);
    }
    if (definition.getInput("pins") && definition.getConfig("pins")) {
      lines.push("::register_gpio_block(blockId, bld_arg_port, bld_arg_pins);");
    }
    lines.push(`#line 1 "block_${index}"`, `return ::${definition.cppFactory}(${args.join(", ")});`);
    return [
      ...(scope ? [`namespace ${scope} {`] : []),
      `#line 1 "block_${index}"`,
      `inline auto bld_factory_${index}(${parameters}) {`,
      ...lines,
      "}",
      ...(scope ? ["}"] : []),
    ].join("\n");
  }

  private value(parameter: string, value: unknown): string {
    if (Array.isArray(value)) {
      return `::bld_config_array<decltype(${parameter})>(${value.map((item) => this.scalar(item)).join(", ")})`;
    }
    return `static_cast<decltype(${parameter})>(${this.scalar(value)})`;
  }

  private scalar(value: unknown): string {
    if (typeof value === "boolean") return String(value);
    if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Config values must be finite numbers or booleans");
    return Object.is(value, -0) ? "-0.0" : String(value);
  }

  private parameters(qualifiedFactory: string): string {
    const factory = qualifiedFactory.split("::").at(-1)!;
    const scope = qualifiedFactory.split("::").slice(0, -1).join("::");
    const declarations = new Set<string>();
    const pattern = new RegExp(`\\b${factory}\\s*\\(`, "g");
    for (const source of Object.values(this.files)) {
      const masked = source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g,
        (text) => " ".repeat(text.length));
      for (const match of masked.matchAll(pattern)) {
        const start = match.index + match[0].length;
        const end = this.endOfParameters(source, start);
        const parameters = source.slice(start, end).trim();
        // Calls do not start with the block-id parameter declaration.
        if (/^[^,=]+\s+blockId\s*(?:,|$)/.test(parameters)
          && this.scopeAt(masked, match.index) === scope) declarations.add(parameters);
      }
    }
    if (declarations.size !== 1) throw new Error(`Expected one parameter declaration for factory ${qualifiedFactory}`);
    return [...declarations][0]!;
  }

  private scopeAt(source: string, offset: number): string {
    const scopes: string[] = [];
    for (const match of source.slice(0, offset).matchAll(/\bnamespace\s+([\w:]+)\s*\{|[{}]/g)) {
      if (match[0] === "}") scopes.pop();
      else scopes.push(match[1] ?? "");
    }
    return scopes.filter(Boolean).join("::");
  }

  private endOfParameters(source: string, start: number): number {
    let depth = 1;
    let quote: string | undefined;
    for (let index = start; index < source.length; index++) {
      const char = source[index]!;
      if (quote) {
        if (char === "\\") index++;
        else if (char === quote) quote = undefined;
      } else if (char === '"' || (char === "'" && !/\w/.test(source[index - 1] ?? ""))) quote = char;
      else if (source.startsWith("//", index)) {
        const end = source.indexOf("\n", index + 2);
        index = end < 0 ? source.length : end;
      } else if (source.startsWith("/*", index)) {
        const end = source.indexOf("*/", index + 2);
        index = end < 0 ? source.length : end + 1;
      } else if (char === "(") depth++;
      else if (char === ")" && --depth === 0) return index;
    }
    throw new Error("Unterminated factory parameter declaration");
  }
}
