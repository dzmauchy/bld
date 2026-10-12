import { expect, test, element, baseURL, fetchAsset, artifactPath } from "./fixtures/browser.ts";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { CoreSchemaCatalog } from "core";

const distDir = join(dirname(fileURLToPath(import.meta.url)), "../dist");
const distSchemas = join(distDir, "schemas");

function collect(dir: string, suffix: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) found.push(...collect(path, suffix));
    else if (entry.name.endsWith(suffix)) found.push(path);
  }
  return found;
}

const baseBlocks = [
  "ConstF32",
  "SinGenF32",
  "CosGenF32",
  "RandGenF32",
  "PulseGenF32",
  "GpioInF32",
  "SinF32",
  "CosF32",
  "SumF32",
  "ProductF32",
  "ScopeF32",
];

test("shows the bld icon splash until 100 ms after the parsed workspace is shown", async ({ page }) => {
  let releaseArchive = () => {};
  const archiveHeld = new Promise<void>((resolve) => {
    releaseArchive = resolve;
  });
  // The splash closes 100 ms after the base library parses. The local archive
  // answers immediately, so hold it until the open splash has been observed.
  await page.setRequestInterception(true);
  page.on("request", async (request) => {
    if (request.url().endsWith("/base-0.1.0.tar.gz")) await archiveHeld;
    await request.continue();
  });

  await page.goto(baseURL(), { waitUntil: "domcontentloaded" });
  const splash = element(page, "[data-splash]");
  await expect.poll(() => splash.visible()).toBe(true);
  await expect.poll(() => splash.getAttribute("data-state")).toBe("open");
  await expect.poll(() => element(page, "link[rel='icon']").getAttribute("href")).toBe("/icons/bld.svg");
  await expect.poll(() => splash.shadow("img.splash-mark").getAttribute("src")).toBe("/icons/bld.svg");
  await expect.poll(() => splash.shadow("wa-spinner").visible()).toBe(true);
  await expect.poll(() => splash.shadow("wa-progress-bar").getAttribute("indeterminate")).toBe("");
  await expect.poll(() => splash.shadow("wa-animation").getAttribute("play")).toBe("");
  const animationName = await splash.shadow(".splash-ring-outer").evaluate((element) => getComputedStyle(element).animationName);
  expect(animationName).toBe("splash-spin");

  await page.evaluate(() => {
    const splashElement = document.querySelector("[data-splash]");
    const watched = window as unknown as { workspaceShownWhileOpen?: Promise<boolean> };
    watched.workspaceShownWhileOpen = new Promise<boolean>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("splash closed before the parsed workspace was shown")), 30_000);
      const done = () => {
        const open = splashElement?.getAttribute("data-state") === "open" && !splashElement.hasAttribute("hidden");
        const shown = document.querySelectorAll("[data-block-id]").length > 0;
        if (!open || !shown) return;
        window.clearTimeout(timeout);
        observer.disconnect();
        resolve(true);
      };
      const observer = new MutationObserver(done);
      observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
      done();
    });
  });
  releaseArchive();
  await page.evaluate(() => (window as unknown as { workspaceShownWhileOpen: Promise<boolean> }).workspaceShownWhileOpen);
  await expect.poll(() => splash.visible()).toBe(false);
  await expect.poll(() => splash.getAttribute("data-state")).toBe("closed");
});

test("splits a black workspace into a palette and a diagram", async ({ page }) => {
  await page.goto(baseURL());
  await expect.poll(() => element(page, "[data-splash]").visible()).toBe(false);
  const palette = element(page, "[data-region=palette]");
  const diagram = element(page, "[data-region=diagram]");
  await expect.poll(() => element(page, "wa-split-panel").visible()).toBe(true);
  await expect.poll(() => palette.visible()).toBe(true);
  await expect.poll(() => diagram.visible()).toBe(true);
  await expect.poll(() => palette.getAttribute("data-libraries")).toBe("base");
  await expect.poll(() => palette.within(".palette-header, .palette-title, .palette-subtitle, h1").count()).toBe(0);
  await expect.poll(() => palette.within("::-p-text(Click to place on the canvas)").count()).toBe(0);
  await expect.poll(() => palette.within(".palette-ns-toggle").first().visible()).toBe(true);
  await expect.poll(() => palette.within("[data-block-id=ScopeF32] .flow-node-icon svg").visible()).toBe(true);
  const blockButton = await palette.within("[data-block-id=ConstF32]").boundingBox();
  expect(blockButton).toBeTruthy();
  expect(blockButton!.height).toBeLessThan(60);
  expect(blockButton!.width / blockButton!.height).toBeGreaterThan(1.2);
  expect(blockButton!.width / blockButton!.height).toBeLessThan(1.4);
  const blockFill = await palette.within("[data-block-id=ConstF32], [data-block-id=SumF32], [data-block-id=ScopeF32]").evaluateAll((buttons) =>
    buttons.map((button) => ({ image: getComputedStyle(button).backgroundImage, color: getComputedStyle(button).backgroundColor })),
  );
  expect(blockFill).toHaveLength(3);
  for (const fill of blockFill) {
    expect(fill.image).toMatch(/^url\(/);
    expect(fill.image).toContain("linear-gradient");
    expect(fill.color).toBe("rgb(32, 36, 39)");
  }
  const gpioClip = await palette.within("[data-block-id=GpioInF32] .flow-node-title").evaluate((element) => element.scrollWidth - element.clientWidth);
  expect(gpioClip).toBeLessThanOrEqual(1);
  const titleSize = await palette.within("[data-block-id=ConstF32] .flow-node-title").evaluate((element) => {
    const fontSize = parseFloat(getComputedStyle(element).fontSize);
    const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return fontSize / rootSize;
  });
  expect(titleSize).toBeCloseTo(0.7, 2);
  const portOpacity = await palette.within("[data-block-id=ConstF32] .flow-node-port-col").first().evaluate((element) => Number(getComputedStyle(element).opacity));
  expect(portOpacity).toBeLessThan(0.6);
  const rowCounts = await palette.within(".palette-blocks-grid").evaluateAll((grids) =>
    grids.map((grid) => {
      const rows = new Map<number, number>();
      for (const button of grid.querySelectorAll("[data-block-id]")) {
        const top = Math.round(button.getBoundingClientRect().top);
        rows.set(top, (rows.get(top) ?? 0) + 1);
      }
      return [...rows.values()];
    }),
  );
  expect(rowCounts.some((counts) => counts.includes(2))).toBe(true);
  for (const counts of rowCounts) {
    for (const count of counts) expect(count).toBeLessThanOrEqual(2);
  }
  expect(await palette.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(28, 33, 37)");
  await expect.poll(() => diagram.within("h1").count()).toBe(0);
  await expect.poll(() => element(page, "[data-toolbar] [data-run-toggle]").text()).toBe("Run");
  await expect.poll(() => element(page, "[data-toolbar]").visible()).toBe(true);

  const paletteBox = await palette.boundingBox();
  const diagramBox = await diagram.boundingBox();
  expect(paletteBox).toBeTruthy();
  expect(diagramBox).toBeTruthy();
  expect(paletteBox!.x).toBeLessThan(diagramBox!.x);
  const column = await palette.evaluate((element) => {
    const shrink = (node: Element) => {
      const clone = node.cloneNode(true);
      if (!(clone instanceof HTMLElement)) return 0;
      clone.style.position = "absolute";
      clone.style.visibility = "hidden";
      clone.style.width = "max-content";
      clone.style.maxWidth = "none";
      clone.style.minWidth = "max-content";
      if (getComputedStyle(node).display === "inline") clone.style.display = "inline-block";
      element.appendChild(clone);
      const width = clone.getBoundingClientRect().width;
      clone.remove();
      return width;
    };
    const titles = [...element.querySelectorAll(".palette-ns-toggle, .flow-node-title")].map(shrink);
    const grid = element.querySelector(".palette-blocks-grid");
    const gridStyle = grid ? getComputedStyle(grid) : undefined;
    const probe = document.createElement("div");
    probe.style.position = "absolute";
    probe.style.visibility = "hidden";
    probe.style.width = "var(--palette-button-width)";
    element.appendChild(probe);
    const button = probe.getBoundingClientRect().width;
    probe.style.width = "var(--palette-column-slack)";
    const slack = probe.getBoundingClientRect().width;
    probe.remove();
    const gap = Number.parseFloat(gridStyle?.columnGap ?? "");
    const padding = Number.parseFloat(gridStyle?.paddingLeft ?? "") + Number.parseFloat(gridStyle?.paddingRight ?? "");
    const twoButtons = button * 2 + (Number.isFinite(gap) ? gap : 0) + (Number.isFinite(padding) ? padding : 0);
    const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize);
    return {
      actual: element.getBoundingClientRect().width,
      expected: Math.max(...titles, twoButtons) + slack,
      slack,
      root,
    };
  });
  expect(Math.abs(column.slack - column.root * 0.1)).toBeLessThan(0.05);
  expect(Math.abs(column.actual - column.expected), JSON.stringify(column)).toBeLessThan(1);
  expect(paletteBox!.width).toBeLessThan(170);
  const centered = await palette.evaluate((element) => {
    const paletteBox = element.getBoundingClientRect();
    const hostMid = (paletteBox.left + paletteBox.right) / 2;
    return [...element.querySelectorAll(".palette-blocks-grid")].map((grid) => {
      const buttons = [...grid.querySelectorAll("[data-block-id]")];
      const left = Math.min(...buttons.map((button) => button.getBoundingClientRect().left));
      const right = Math.max(...buttons.map((button) => button.getBoundingClientRect().right));
      return Math.abs((left + right) / 2 - hostMid);
    });
  });
  expect(centered.length).toBeGreaterThan(0);
  for (const delta of centered) expect(delta).toBeLessThan(2);
  expect(diagramBox!.width).toBeGreaterThan(paletteBox!.width);
  expect(Math.abs(paletteBox!.height - diagramBox!.height)).toBeLessThan(2);

  expect(await diagram.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(0, 0, 0)");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(0, 0, 0)");

  await expect.poll(() => palette.within("[data-block-id]").count()).toBe(baseBlocks.length * 2);
  for (const id of baseBlocks) {
    await expect.poll(() => palette.within(`[data-block-id="${id}"]`).count()).toBe(1);
  }

  const sinks = palette.within('[data-namespace="push::f_32::sinks"] > .palette-ns-toggle');
  await sinks.click();
  await expect.poll(() => palette.within("[data-block-id=ScopeF32]").visible()).toBe(false);
  await sinks.click();
  await expect.poll(() => palette.within("[data-block-id=ScopeF32]").visible()).toBe(true);

  const scope = palette.within("[data-block-id=ScopeF32]");
  await scope.click();
  await expect.poll(() => scope.getAttribute("data-armed")).toBe("true");
  await expect.poll(() => diagram.within("[data-block-ref=ScopeF32]").count()).toBe(0);
  await diagram.within("[data-diagram-canvas]").click({ position: { x: 96, y: 80 } });
  await expect.poll(() => diagram.within("[data-block-ref=ScopeF32]").count()).toBe(1);
  await expect.poll(() => diagram.within("[data-block-ref=ScopeF32]").text()).toContain("Scope");
  const placed = diagram.within("[data-block-ref=ScopeF32]");
  const placedBox = await placed.boundingBox();
  expect(placedBox!.height).toBeLessThan(70);
  expect(placedBox!.width).toBeLessThan(90);
  expect(await placed.evaluate((element) => getComputedStyle(element).backgroundImage)).toMatch(/^url\(/);
  expect(await placed.evaluate((element) => getComputedStyle(element).backgroundImage)).toContain("linear-gradient");
  for (const [icon, label, size] of [
    [placed.within(".diagram-block-icon svg"), placed.within(".diagram-block-title"), 28],
    [scope.within(".flow-node-icon svg"), scope.within(".flow-node-title"), 24],
  ] as const) {
    const iconBox = await icon.boundingBox();
    const labelBox = await label.boundingBox();
    expect(iconBox!.width).toBe(size);
    expect(iconBox!.y + iconBox!.height).toBeLessThan(labelBox!.y);
    expect(await label.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: artifactPath("matte-blocks.png") });
});

test("copies all JSON schemas into ui/dist/schemas", () => {
  expect(readdirSync(distSchemas).sort()).toEqual(CoreSchemaCatalog.shared.publishedFiles());
});

test("client bundle uses release metadata and the pinned compiler", () => {
  const scripts = collect(distDir, ".js")
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  expect(scripts).not.toContain("tree-sitter");
  expect(scripts).not.toContain("TreeSitter");
  expect(scripts).not.toContain("HeaderCommentCatalog");
  expect(scripts).toContain("dump-ast");
  expect(scripts).toContain("clang-23.1.2");
  expect(scripts).toContain("releases/download/");
  expect(scripts).toContain("clang.wasm");
  expect(scripts).toContain("lld.wasm");
  expect(scripts).toContain("sysroot.tgz");
  expect(collect(distDir, ".wasm")).toEqual([]);
});

test("serves JSON schemas from /schemas", async () => {
  for (const name of CoreSchemaCatalog.shared.schemaNames) {
    const response = await fetchAsset(`/schemas/${name}.schema.json`);
    expect(response.ok, name).toBeTruthy();
    const body = await response.json();
    expect(body.$id).toContain(`/schemas/${name}.schema.json`);
  }
});
