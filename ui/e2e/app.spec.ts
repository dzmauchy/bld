import { expect, test } from "@playwright/test";
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
  await page.route("**/base-0.1.0.tar.gz", async (route) => {
    await archiveHeld;
    await route.continue();
  });

  await page.goto("/", { waitUntil: "commit" });
  const splash = page.locator("[data-splash]");
  await expect(splash).toBeVisible();
  await expect(splash).toHaveAttribute("data-state", "open");
  await expect(page.locator("link[rel='icon']")).toHaveAttribute("href", "/icons/bld.svg");
  await expect(splash.locator("img.splash-mark")).toHaveAttribute("src", "/icons/bld.svg");
  await expect(splash.locator("wa-spinner")).toBeVisible();
  await expect(splash.locator("wa-progress-bar")).toHaveAttribute("indeterminate", "");
  await expect(splash.locator("wa-animation")).toHaveAttribute("play", "");
  const animationName = await splash.locator(".splash-ring-outer").evaluate((element) => getComputedStyle(element).animationName);
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
  await expect(splash).toBeHidden();
  await expect(splash).toHaveAttribute("data-state", "closed");
});

test("splits a black workspace into a palette and a diagram", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("[data-splash]")).toBeHidden();
  const palette = page.locator("[data-region=palette]");
  const diagram = page.locator("[data-region=diagram]");
  await expect(page.locator("wa-split-panel")).toBeVisible();
  await expect(palette).toBeVisible();
  await expect(diagram).toBeVisible();
  await expect(palette).toHaveAttribute("data-libraries", "base");
  await expect(palette.locator("h1")).toHaveText("Palette");
  await expect(palette.locator(".palette-subtitle")).toHaveText("Click to place on the canvas");
  await expect(palette.locator(".palette-ns-toggle").first()).toBeVisible();
  await expect(palette.locator("[data-block-id=ScopeF32] .flow-node-icon svg")).toBeVisible();
  const blockButton = await palette.locator("[data-block-id=ConstF32]").boundingBox();
  expect(blockButton).toBeTruthy();
  expect(blockButton!.height).toBeLessThan(60);
  expect(blockButton!.width / blockButton!.height).toBeGreaterThan(1.15);
  expect(blockButton!.width / blockButton!.height).toBeLessThan(1.25);
  const titleSize = await palette.locator("[data-block-id=ConstF32] .flow-node-title").evaluate((element) => {
    const fontSize = parseFloat(getComputedStyle(element).fontSize);
    const rootSize = parseFloat(getComputedStyle(document.documentElement).fontSize);
    return fontSize - rootSize * 0.5;
  });
  expect(titleSize).toBeCloseTo(96 / 72, 1);
  const portOpacity = await palette.locator("[data-block-id=ConstF32] .flow-node-port-col").first().evaluate((element) => Number(getComputedStyle(element).opacity));
  expect(portOpacity).toBeLessThan(0.6);
  const rowCounts = await palette.locator(".palette-blocks-grid").evaluateAll((grids) =>
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
  await expect(diagram.locator("h1")).toHaveText("Diagram");

  const paletteBox = await palette.boundingBox();
  const diagramBox = await diagram.boundingBox();
  expect(paletteBox).toBeTruthy();
  expect(diagramBox).toBeTruthy();
  expect(paletteBox!.x).toBeLessThan(diagramBox!.x);
  expect(paletteBox!.width).toBeGreaterThan(160);
  expect(diagramBox!.width).toBeGreaterThan(paletteBox!.width);
  expect(Math.abs(paletteBox!.height - diagramBox!.height)).toBeLessThan(2);

  expect(await diagram.evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(0, 0, 0)");
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe("rgb(0, 0, 0)");

  await expect(palette.locator("[data-block-id]")).toHaveCount(baseBlocks.length * 2);
  for (const id of baseBlocks) {
    await expect(palette.locator(`[data-block-id="${id}"]`)).toHaveCount(1);
  }

  const sinks = palette.locator('[data-namespace="push::f32::sinks"] > .palette-ns-toggle');
  await sinks.click();
  await expect(palette.locator("[data-block-id=ScopeF32]")).toBeHidden();
  await sinks.click();
  await expect(palette.locator("[data-block-id=ScopeF32]")).toBeVisible();

  await palette.locator("[data-block-id=ScopeF32]").click();
  await expect(diagram.locator("[data-block-ref=ScopeF32]")).toHaveCount(1);
  await expect(diagram.locator("[data-block-ref=ScopeF32]")).toContainText("Scope");
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

test("serves JSON schemas from /schemas", async ({ request }) => {
  for (const name of CoreSchemaCatalog.shared.schemaNames) {
    const response = await request.get(`/schemas/${name}.schema.json`);
    expect(response.ok(), name).toBeTruthy();
    const body = await response.json();
    expect(body.$id).toContain(`/schemas/${name}.schema.json`);
  }
});
