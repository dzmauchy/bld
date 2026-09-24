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
  "const_f32",
  "sin_gen_f32",
  "cos_gen_f32",
  "rand_gen_f32",
  "pulse_gen_f32",
  "gpio_in_f32",
  "sin_f32",
  "cos_f32",
  "sum_f32",
  "product_f32",
  "scope_f32",
];

test("shows the bld icon splash until 100 ms after load", async ({ page }) => {
  let releaseIcon = () => {};
  const iconHeld = new Promise<void>((resolve) => {
    releaseIcon = resolve;
  });
  await page.route("**/icons/bld.svg", async (route) => {
    await iconHeld;
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

  releaseIcon();
  await page.waitForLoadState("load");
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

  await expect(palette.locator("[data-block-id]")).toHaveCount(baseBlocks.length);
  for (const id of baseBlocks) {
    await expect(palette.locator(`[data-block-id="${id}"]`)).toHaveCount(1);
  }

  await palette.locator("[data-block-id=scope_f32]").click();
  await expect(diagram.locator("[data-block-ref=scope_f32]")).toHaveCount(1);
  await expect(diagram.locator("[data-block-ref=scope_f32]")).toContainText("Scope");
});

test("copies all JSON schemas into ui/dist/schemas", () => {
  expect(readdirSync(distSchemas).sort()).toEqual(CoreSchemaCatalog.shared.publishedFiles());
});

test("client bundle has no C++ parser wasm assets", () => {
  const scripts = collect(distDir, ".js")
    .map((path) => readFileSync(path, "utf8"))
    .join("\n");
  expect(scripts).not.toContain("tree-sitter");
  expect(scripts).not.toContain("TreeSitter");
  expect(collect(distDir, ".wasm")).toHaveLength(0);
});

test("serves JSON schemas from /schemas", async ({ request }) => {
  for (const name of CoreSchemaCatalog.shared.schemaNames) {
    const response = await request.get(`/schemas/${name}.schema.json`);
    expect(response.ok(), name).toBeTruthy();
    const body = await response.json();
    expect(body.$id).toContain(`/schemas/${name}.schema.json`);
  }
});
