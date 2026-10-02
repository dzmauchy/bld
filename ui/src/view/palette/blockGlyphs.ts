import boolSvg from "../../../public/icons/bool.svg?raw";
import constantSvg from "../../../public/icons/constant.svg?raw";
import cosSvg from "../../../public/icons/cos.svg?raw";
import dataSvg from "../../../public/icons/data.svg?raw";
import decisionSvg from "../../../public/icons/decision.svg?raw";
import enumSvg from "../../../public/icons/enum.svg?raw";
import f32Svg from "../../../public/icons/f32.svg?raw";
import f64Svg from "../../../public/icons/f64.svg?raw";
import funcSvg from "../../../public/icons/func.svg?raw";
import globalSvg from "../../../public/icons/global.svg?raw";
import gpioInSvg from "../../../public/icons/gpio_in.svg?raw";
import gpioOutSvg from "../../../public/icons/gpio_out.svg?raw";
import i32Svg from "../../../public/icons/i32.svg?raw";
import i64Svg from "../../../public/icons/i64.svg?raw";
import identitySvg from "../../../public/icons/identity.svg?raw";
import intSvg from "../../../public/icons/int.svg?raw";
import integerSvg from "../../../public/icons/integer.svg?raw";
import listSvg from "../../../public/icons/list.svg?raw";
import mapSvg from "../../../public/icons/map.svg?raw";
import menuSvg from "../../../public/icons/menu.svg?raw";
import optionalSvg from "../../../public/icons/optional.svg?raw";
import outputSvg from "../../../public/icons/output.svg?raw";
import overshootSvg from "../../../public/icons/overshoot.svg?raw";
import processSvg from "../../../public/icons/process.svg?raw";
import productSvg from "../../../public/icons/product.svg?raw";
import pulseSvg from "../../../public/icons/pulse.svg?raw";
import randomSvg from "../../../public/icons/random.svg?raw";
import runSvg from "../../../public/icons/run.svg?raw";
import scopeSvg from "../../../public/icons/scope.svg?raw";
import sinSvg from "../../../public/icons/sin.svg?raw";
import startSvg from "../../../public/icons/start.svg?raw";
import stopSvg from "../../../public/icons/stop.svg?raw";
import stringSvg from "../../../public/icons/string.svg?raw";
import sumSvg from "../../../public/icons/sum.svg?raw";
import tableSvg from "../../../public/icons/table.svg?raw";
import timerSvg from "../../../public/icons/timer.svg?raw";

const glyphSources: Readonly<Record<string, string>> = {
  "bool.svg": boolSvg,
  "constant.svg": constantSvg,
  "cos.svg": cosSvg,
  "data.svg": dataSvg,
  "decision.svg": decisionSvg,
  "enum.svg": enumSvg,
  "f32.svg": f32Svg,
  "f64.svg": f64Svg,
  "func.svg": funcSvg,
  "global.svg": globalSvg,
  "gpio_in.svg": gpioInSvg,
  "gpio_out.svg": gpioOutSvg,
  "i32.svg": i32Svg,
  "i64.svg": i64Svg,
  "identity.svg": identitySvg,
  "int.svg": intSvg,
  "integer.svg": integerSvg,
  "list.svg": listSvg,
  "map.svg": mapSvg,
  "menu.svg": menuSvg,
  "optional.svg": optionalSvg,
  "output.svg": outputSvg,
  "overshoot.svg": overshootSvg,
  "process.svg": processSvg,
  "product.svg": productSvg,
  "pulse.svg": pulseSvg,
  "random.svg": randomSvg,
  "run.svg": runSvg,
  "scope.svg": scopeSvg,
  "sin.svg": sinSvg,
  "start.svg": startSvg,
  "stop.svg": stopSvg,
  "string.svg": stringSvg,
  "sum.svg": sumSvg,
  "table.svg": tableSvg,
  "timer.svg": timerSvg,
};

const aliases = new Map<string, string>([
  ["push.const", "constant"],
  ["const", "constant"],
  ["push.cos-gen", "cos"],
  ["cos-gen", "cos"],
  ["push.sin-gen", "sin"],
  ["sin-gen", "sin"],
  ["push.rand-gen", "random"],
  ["rand-gen", "random"],
  ["push.pulse-gen", "pulse"],
  ["pulse-gen", "pulse"],
  ["push.gpio_in", "gpio_in"],
  ["push.gpio_out", "gpio_out"],
]);

/** Stroke icons for palette tiles. Unknown names fall back to the process glyph. */
export class BlockGlyphCatalog {
  static readonly shared = new BlockGlyphCatalog();

  private readonly byStem = new Map<string, string>();

  constructor(sources: Readonly<Record<string, string>> = glyphSources) {
    for (const [file, svg] of Object.entries(sources)) {
      this.byStem.set(file.replace(/\.svg$/i, ""), innerSvg(svg));
    }
  }

  markup(icon: string | undefined): string {
    const body = this.resolve(icon);
    return `<svg xmlns="http://www.w3.org/2000/svg" class="block-icon" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  }

  private resolve(icon: string | undefined): string {
    const stem = stemOf(icon);
    const candidates = [stem, aliases.get(stem), stem.split(".").at(-1), aliases.get(stem.split(".").at(-1) ?? "")];
    for (const candidate of candidates) {
      if (!candidate) continue;
      const direct = this.byStem.get(candidate);
      if (direct) return direct;
      const aliased = aliases.get(candidate);
      const viaAlias = aliased ? this.byStem.get(aliased) : undefined;
      if (viaAlias) return viaAlias;
    }
    return this.byStem.get("process") ?? "";
  }
}

function stemOf(icon: string | undefined): string {
  const file = (icon ?? "").split(/[/\\]/).pop() ?? "";
  return file.replace(/\.(svg|png)$/i, "");
}

function innerSvg(svg: string): string {
  const match = svg.match(/<svg\b[^>]*>([\s\S]*)<\/svg>/i);
  return (match?.[1] ?? "").trim();
}
