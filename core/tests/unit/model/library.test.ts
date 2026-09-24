import { describe, expect, test, vi } from "vitest";
import { resolveUrl } from "../../../src/model/appAssets.js";
import { readNodeAsset } from "../../readNodeAsset.ts";
import { packTar } from "modern-tar";
import {
  CompilationModel,
  Library,
  LibraryArchive,
  Palette,
  TypeSystem,
  clearRegisteredAppAssets,
  fetchText,
  getRegisteredAppAsset,
  loadAsset,
  normalizeAssetPath,
  registerAppAsset,
  registerAppAssetBytes,
  registerAppAssets,
  setAppAssetResolver,
} from "../../../src/model/index.js";

describe("Library and Asset Loader", () => {
  test("resolves relative URLs against base URLs", () => {
    expect(resolveUrl("include/bld.hpp", "https://example.com/libs/base.json")).toBe(
      "https://example.com/libs/include/bld.hpp",
    );
    expect(resolveUrl("native/base.hpp", "https://example.com/lib/manifest.json")).toBe(
      "https://example.com/lib/native/base.hpp",
    );
    expect(resolveUrl("https://other.com/base.hpp", "https://example.com/base.json")).toBe(
      "https://other.com/base.hpp",
    );
    expect(resolveUrl("https://other.com/base.hpp")).toBe(
      "https://other.com/base.hpp",
    );
    expect(resolveUrl("include/bld.hpp")).toBe("include/bld.hpp");
    expect(resolveUrl("//cdn.example.com/lib.json", "https://example.com/")).toBe(
      "https://cdn.example.com/lib.json",
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

    const gpio = lib.palette.getBlock("gpio_in_f32");
    expect(gpio).toBeDefined();
    expect(gpio?.category).toBe("sources");
    expect(gpio?.cppClass).toBe("push::f32::sources::GpioInF32");

    // In-memory CompilationModel populated
    expect(lib.compilationModel).toBeInstanceOf(CompilationModel);

    // Base library is cached
    expect(Library.getBaseSync()).toBe(lib);
  });

  test("fetches a remote library archive and unpacks it with modern-tar", async () => {
    const header = [
      '/*{"kind":"type","id":"custom_t","name":"Custom Type","description":"A custom test type"}*/',
      "using custom_t = int;",
      '/*{"kind":"namespace","name":"Custom NS"}*/',
      "namespace custom_ns {",
      '/*{"kind":"block","id":"custom_block","ns":["custom_ns"],"icon":"custom.svg","title":"Custom Block","description":"A custom test block"}*/',
      "class CustomBlock {};",
      "}",
    ].join("\n");
    const archive = await gzipTar({ "plugin.hpp": header });
    const originalFetch = globalThis.fetch;
    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u === "https://my-plugin.org/dsp/library.json") {
        return new Response(
          JSON.stringify({
            id: "remote_plugin",
            name: "Remote Plugin",
            icon: "plugin.svg",
            location: "https://my-plugin.org/dsp/plugin.tar.gz",
          }),
          { status: 200 },
        );
      }
      if (u === "https://my-plugin.org/dsp/plugin.tar.gz") {
        return new Response(new Blob([archive]), { status: 200 });
      }
      return new Response("Not found", { status: 404 });
    });

    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const lib = await Library.load("https://my-plugin.org/dsp/library.json");
      expect(lib.id).toBe("remote_plugin");
      expect(lib.name).toBe("Remote Plugin");
      expect(lib.icon).toBe("plugin.svg");
      expect(lib.typeSystem.getPrimitive("custom_t")).toBeDefined();
      expect(lib.palette.getBlock("custom_block")).toBeDefined();

      expect(fetchMock).toHaveBeenCalledWith("https://my-plugin.org/dsp/library.json");
      expect(fetchMock).toHaveBeenCalledWith("https://my-plugin.org/dsp/plugin.tar.gz");
      expect(lib.palette.getBlock("custom_block")?.cppClass).toBe("custom_ns::CustomBlock");
      expect(lib.compilationModel.getFile("plugin.hpp")).toContain("class CustomBlock");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("registered in-memory app assets take priority for relative URLs", async () => {
    registerAppAsset("custom_app_asset.json", JSON.stringify({ custom: "data" }));
    expect(getRegisteredAppAsset("custom_app_asset.json")).toBe(JSON.stringify({ custom: "data" }));
  });

  test("normalizes asset paths and loads via the shared AppAssetStore", async () => {
    expect(normalizeAssetPath("./native/blocks.ts")).toBe("native/blocks.ts");

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
      setAppAssetResolver(readNodeAsset);
    }
  });

  test("readNodeAsset reads asset files from local filesystem", async () => {
    const content = await readNodeAsset("base.json");
    expect(content).toBeDefined();
    expect(JSON.parse(content!).id).toBe("base");
    expect(JSON.parse(content!).location).toContain("base-0.1.0.tar.gz");
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

  test("relative archive locations load from internal resources", async () => {
    const header = [
      "namespace samples {",
      '/*{"kind":"block","id":"local_block","ns":["samples"],"icon":"local.svg","title":"Local","description":"Loaded from an internal header"}*/',
      "class Local {};",
      "}",
    ].join("\n");
    registerAppAssets({
      "internal.json": JSON.stringify({
        id: "internal",
        name: "Internal",
        icon: "internal.svg",
        location: "samples/lib.tar.gz",
      }),
    });
    registerAppAssetBytes("samples/lib.tar.gz", await gzipTar({ "block.hpp": header }));
    const fetchMock = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const lib = await Library.load("internal.json");
      expect(fetchMock).not.toHaveBeenCalled();
      expect(lib.palette.getBlock("local_block")?.title).toBe("Local");
      expect(lib.compilationModel.getFile("block.hpp")).toContain("class Local");
    } finally {
      globalThis.fetch = originalFetch;
      clearRegisteredAppAssets();
    }
  });

  test("LibraryArchive unpacks header files from a tar.gz", async () => {
    const archive = await LibraryArchive.fromTarGz(await gzipTar({
      "include/bld.hpp": "namespace bld {}",
      "notes.txt": "ignore",
    }));
    expect(archive.files()).toEqual({ "bld.hpp": "namespace bld {}" });
  });

  test("header block classes match the C++ catalog", async () => {
    const lib = await Library.loadBase();
    for (const [id, raw] of Object.entries(lib.blocks)) {
      expect(raw.cpp, id).toBe(lib.palette.getBlock(id)?.cppClass);
    }
  });
});

async function gzipTar(files: Record<string, string>): Promise<Uint8Array<ArrayBuffer>> {
  const encoder = new TextEncoder();
  const tar = await packTar(Object.entries(files).map(([name, body]) => {
    const encoded = encoder.encode(body);
    return { header: { name, size: encoded.byteLength }, body: encoded };
  }));
  const compressed = await new Response(
    new Blob([copyBytes(tar)]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
  return new Uint8Array(compressed);
}

function copyBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

