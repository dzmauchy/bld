import { describe, expect, test, vi } from "vitest";
import {
  AppAssetStore,
  CompilationModel,
  Library,
  Palette,
  TypeSystem,
  clearRegisteredAppAssets,
  fetchText,
  getRegisteredAppAsset,
  isRelativeUrl,
  loadAsset,
  normalizeAssetPath,
  registerAppAsset,
  registerAppAssets,
  resolveUrl,
  setAppAssetResolver,
} from "../../../src/model/index.js";

describe("Library and Asset Loader", () => {
  test("distinguishes relative URLs from absolute URLs", () => {
    expect(isRelativeUrl("types.json")).toBe(true);
    expect(isRelativeUrl("./types.json")).toBe(true);
    expect(isRelativeUrl("assembly/blocks.ts")).toBe(true);
    expect(isRelativeUrl("/assets/blocks.json")).toBe(true);
    expect(isRelativeUrl("https://example.com/lib.json")).toBe(false);
    expect(isRelativeUrl("http://localhost:3000/lib.json")).toBe(false);
    expect(isRelativeUrl("//cdn.example.com/lib.json")).toBe(false);
  });

  test("resolves relative URLs against base URLs", () => {
    expect(resolveUrl("types.json", "https://example.com/libs/base.json")).toBe(
      "https://example.com/libs/types.json",
    );
    expect(resolveUrl("blocks.json", "base.json")).toBe("blocks.json");
    expect(resolveUrl("sub/blocks.json", "lib/manifest.json")).toBe("lib/sub/blocks.json");
    expect(resolveUrl("https://other.com/blocks.json", "https://example.com/base.json")).toBe(
      "https://other.com/blocks.json",
    );
  });

  test("loads base.json and builds model and compilation model in memory", async () => {
    const lib = await Library.load("base.json");
    expect(lib).toBeInstanceOf(Library);
    expect(lib.id).toBe("base");
    expect(lib.name).toBe("Base");

    // In-memory TypeSystem populated
    expect(lib.typeSystem).toBeInstanceOf(TypeSystem);
    expect(lib.typeSystem.getPrimitive("bool")).toBeDefined();
    expect(lib.typeSystem.getPrimitive("f32")).toBeDefined();
    expect(lib.typeSystem.getParameterizedTemplate("pss")).toBeDefined();

    // In-memory Palette populated
    expect(lib.palette).toBeInstanceOf(Palette);
    const scope = lib.palette.getBlock("scope_f32");
    expect(scope).toBeDefined();
    expect(scope?.title).toBe("Scope");
    expect(scope?.category).toBe("sinks");

    const cos = lib.palette.getBlock("cos_f32");
    expect(cos).toBeDefined();
    expect(cos?.category).toBe("transformers");

    const gpio = lib.palette.getBlock("gpio_in");
    expect(gpio).toBeDefined();
    expect(gpio?.category).toBe("sources");

    // In-memory CompilationModel populated
    expect(lib.compilationModel).toBeInstanceOf(CompilationModel);
    const blocksSource = lib.compilationModel.getFile("blocks.ts");
    expect(blocksSource).toBeDefined();
    expect(blocksSource).toContain("export class scope_f32");

    // Base library is cached
    expect(Library.getBaseSync()).toBe(lib);
  });

  test("fetches absolute URLs via HTTP when not relative", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u === "https://my-plugin.org/dsp/library.json") {
        return new Response(
          JSON.stringify({
            id: "remote_plugin",
            name: "Remote Plugin",
            types: ["https://my-plugin.org/dsp/types.json"],
            namespaces: ["https://my-plugin.org/dsp/namespaces.json"],
            blocks: ["https://my-plugin.org/dsp/blocks.json"],
            assembly: ["https://my-plugin.org/dsp/plugin.ts"],
          }),
          { status: 200 },
        );
      }
      if (u === "https://my-plugin.org/dsp/types.json") {
        return new Response(
          JSON.stringify({
            custom_t: {
              name: "Custom Type",
              description: "A custom test type",
            },
          }),
          { status: 200 },
        );
      }
      if (u === "https://my-plugin.org/dsp/namespaces.json") {
        return new Response(
          JSON.stringify({
            custom_ns: {
              name: "Custom NS",
            },
          }),
          { status: 200 },
        );
      }
      if (u === "https://my-plugin.org/dsp/blocks.json") {
        return new Response(
          JSON.stringify({
            custom_block: {
              ns: ["custom_ns"],
              icon: "custom.svg",
              title: "Custom Block",
              description: "A custom test block",
            },
          }),
          { status: 200 },
        );
      }
      if (u === "https://my-plugin.org/dsp/plugin.ts") {
        return new Response("// custom assembly code\nexport class custom_block {}", {
          status: 200,
        });
      }
      return new Response("Not found", { status: 404 });
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const lib = await Library.load("https://my-plugin.org/dsp/library.json");
      expect(lib.id).toBe("remote_plugin");
      expect(lib.name).toBe("Remote Plugin");
      expect(lib.typeSystem.getPrimitive("custom_t")).toBeDefined();
      expect(lib.palette.getBlock("custom_block")).toBeDefined();
      expect(lib.compilationModel.getFile("plugin.ts")).toContain("export class custom_block");

      // Verify fetch was invoked for the absolute URLs
      expect(fetchMock).toHaveBeenCalledWith("https://my-plugin.org/dsp/library.json");
      expect(fetchMock).toHaveBeenCalledWith("https://my-plugin.org/dsp/types.json");
      expect(fetchMock).toHaveBeenCalledWith("https://my-plugin.org/dsp/namespaces.json");
      expect(fetchMock).toHaveBeenCalledWith("https://my-plugin.org/dsp/blocks.json");
      expect(fetchMock).toHaveBeenCalledWith("https://my-plugin.org/dsp/plugin.ts");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("registered in-memory app assets take priority for relative URLs", async () => {
    registerAppAsset("custom_app_asset.json", JSON.stringify({ custom: "data" }));
    expect(getRegisteredAppAsset("custom_app_asset.json")).toBe(JSON.stringify({ custom: "data" }));
  });

  test("normalizes asset paths and loads via the shared AppAssetStore", async () => {
    expect(normalizeAssetPath("./assembly/blocks.ts")).toBe("assembly/blocks.ts");
    expect(AppAssetStore.isRelativeUrl("types.json")).toBe(true);

    registerAppAssets({
      "bundle/a.json": "{\"a\":1}",
      "bundle/b.json": "{\"b\":2}",
    });
    expect(getRegisteredAppAsset("bundle/a.json")).toBe("{\"a\":1}");
    expect(getRegisteredAppAsset("a.json")).toBe("{\"a\":1}");

    const loaded = await loadAsset("bundle/b.json");
    expect(loaded).toBe("{\"b\":2}");

    clearRegisteredAppAssets();
    expect(getRegisteredAppAsset("bundle/a.json")).toBeUndefined();
  });

  test("custom asset resolver is consulted before registered files", async () => {
    setAppAssetResolver((path) => {
      if (path === "resolver-only.json") return Promise.resolve("{\"from\":\"resolver\"}");
      return Promise.resolve(undefined);
    });
    try {
      expect(await loadAsset("resolver-only.json")).toBe("{\"from\":\"resolver\"}");
    } finally {
      setAppAssetResolver(null);
    }
  });

  test("fetchText loads absolute URLs", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      if (String(url) === "https://example.com/ping.txt") {
        return new Response("pong", { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    }) as typeof fetch;
    try {
      expect(await fetchText("https://example.com/ping.txt")).toBe("pong");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("loadBase returns the cached base library and exposes the icon", async () => {
    const lib = await Library.loadBase();
    expect(lib).toBe(Library.getBaseSync());
    expect(lib.icon).toBe("library-base.svg");
    expect(Palette.fromLibrary(lib)).toBe(lib.palette);
    expect(TypeSystem.fromLibrary(lib)).toBe(lib.typeSystem);
  });

  test("Palette.fromCatalog rebuilds blocks from library sources", async () => {
    const lib = await Library.loadBase();
    const palette = Palette.fromCatalog(lib.blocks, lib.types, lib.namespaces);
    expect(palette.hasBlock("scope_f32")).toBe(true);
    expect(palette.getBlock("scope_f32")?.title).toBe("Scope");
  });
});
