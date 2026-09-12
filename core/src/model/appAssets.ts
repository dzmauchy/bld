/**
 * @title App Assets
 */
export type AssetResolver = (path: string) => Promise<string | undefined>;

declare const process:
  | {
      versions?: { node?: string };
      cwd?: () => string;
      getBuiltinModule?: (name: string) => unknown;
    }
  | undefined;

export class AppAssetStore {
  static readonly shared = new AppAssetStore();

  private readonly assets = new Map<string, string>();
  private resolver: AssetResolver | null = null;

  static isRelativeUrl(url: string): boolean {
    return !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url) && !url.startsWith("//");
  }

  static normalizePath(path: string): string {
    return path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/^\//, "");
  }

  static resolveUrl(url: string, baseUrl?: string): string {
    if (!baseUrl || !AppAssetStore.isRelativeUrl(url)) {
      return url;
    }
    if (!AppAssetStore.isRelativeUrl(baseUrl)) {
      try {
        return new URL(url, baseUrl).href;
      } catch {
        return url;
      }
    }
    const baseDir = baseUrl.includes("/") ? baseUrl.slice(0, baseUrl.lastIndexOf("/") + 1) : "";
    return AppAssetStore.normalizePath(`${baseDir}${url}`);
  }

  static async fetchText(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  register(path: string, content: string): void {
    const norm = AppAssetStore.normalizePath(path);
    this.assets.set(norm, content);
    const slash = norm.lastIndexOf("/");
    if (slash !== -1) {
      const base = norm.slice(slash + 1);
      if (!this.assets.has(base)) {
        this.assets.set(base, content);
      }
    }
  }

  registerAll(assets: Record<string, string>): void {
    for (const [path, content] of Object.entries(assets)) {
      this.register(path, content);
    }
  }

  get(path: string): string | undefined {
    const norm = AppAssetStore.normalizePath(path);
    if (this.assets.has(norm)) return this.assets.get(norm);
    const slash = norm.lastIndexOf("/");
    if (slash !== -1) {
      const base = norm.slice(slash + 1);
      if (this.assets.has(base)) return this.assets.get(base);
    }
    return undefined;
  }

  clear(): void {
    this.assets.clear();
  }

  setResolver(resolver: AssetResolver | null): void {
    this.resolver = resolver
      ? (path) => Promise.resolve(resolver(path))
      : null;
  }

  async load(url: string, baseUrl?: string): Promise<string> {
    const resolved = AppAssetStore.resolveUrl(url, baseUrl);

    if (!AppAssetStore.isRelativeUrl(resolved)) {
      return AppAssetStore.fetchText(resolved);
    }

    const cleanPath = AppAssetStore.normalizePath(resolved);

    if (this.resolver) {
      const result = await Promise.resolve(this.resolver(cleanPath));
      if (result !== undefined) return result;
    }

    const registered = this.get(cleanPath);
    if (registered !== undefined) {
      return registered;
    }

    const nodeContent = this.readNodeAsset(cleanPath);
    if (nodeContent !== undefined) {
      return nodeContent;
    }

    if (typeof fetch === "function") {
      const candidates = [`/assets/${cleanPath}`, `/${cleanPath}`, cleanPath];
      for (const candidate of candidates) {
        try {
          const res = await fetch(candidate);
          if (res.ok) {
            return await res.text();
          }
        } catch {
          // Try next candidate
        }
      }
    }

    throw new Error(`App asset not found: ${cleanPath}`);
  }

  private readNodeAsset(cleanPath: string): string | undefined {
    const proc = typeof process !== "undefined" ? process : undefined;
    if (proc?.versions?.node && typeof proc.getBuiltinModule === "function") {
      try {
        const fs = proc.getBuiltinModule("node:fs") as
          | { readFileSync: (p: string, enc: string) => string }
          | undefined;
        const path = proc.getBuiltinModule("node:path") as
          | { join: (...args: string[]) => string; dirname: (p: string) => string }
          | undefined;
        const url = proc.getBuiltinModule("node:url") as
          | { fileURLToPath: (url: string | URL) => string }
          | undefined;

        if (!fs || !path || !url) return undefined;

        const currentDir = path.dirname(url.fileURLToPath(import.meta.url));
        const cwd = proc.cwd?.() ?? "";
        const candidates = [
          path.join(currentDir, "../../assets", cleanPath),
          path.join(currentDir, "../../../core/assets", cleanPath),
          path.join(cwd, "assets", cleanPath),
          path.join(cwd, "core/assets", cleanPath),
        ];

        for (const candidate of candidates) {
          try {
            return fs.readFileSync(candidate, "utf8");
          } catch {
            // Continue to next candidate
          }
        }
      } catch {
        return undefined;
      }
    }
    return undefined;
  }
}

export function isRelativeUrl(url: string): boolean {
  return AppAssetStore.isRelativeUrl(url);
}

export function normalizeAssetPath(path: string): string {
  return AppAssetStore.normalizePath(path);
}

export function resolveUrl(url: string, baseUrl?: string): string {
  return AppAssetStore.resolveUrl(url, baseUrl);
}

export function registerAppAsset(path: string, content: string): void {
  AppAssetStore.shared.register(path, content);
}

export function registerAppAssets(assets: Record<string, string>): void {
  AppAssetStore.shared.registerAll(assets);
}

export function getRegisteredAppAsset(path: string): string | undefined {
  return AppAssetStore.shared.get(path);
}

export function clearRegisteredAppAssets(): void {
  AppAssetStore.shared.clear();
}

export function setAppAssetResolver(resolver: AssetResolver | null): void {
  AppAssetStore.shared.setResolver(resolver);
}

export async function fetchText(url: string): Promise<string> {
  return AppAssetStore.fetchText(url);
}

export async function loadAsset(url: string, baseUrl?: string): Promise<string> {
  return AppAssetStore.shared.load(url, baseUrl);
}
