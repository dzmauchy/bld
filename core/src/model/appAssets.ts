/**
 * @title App Assets
 */
export type AssetResolver = (path: string) => Promise<string | undefined>;

export interface IAssetResolver {
  resolve(path: string): Promise<string | undefined>;
}

export abstract class AbstractAssetStore {
  abstract get(path: string): string | undefined;
  abstract load(url: string): Promise<string>;
  abstract register(path: string, content: string): void;
  abstract registerAll(assets: Record<string, string>): void;
  abstract clear(): void;
}

export class AppAssetStore extends AbstractAssetStore {
  private static readonly _shared = new AppAssetStore();
  static get shared(): AppAssetStore {
    return this._shared;
  }

  private readonly assets = new Map<string, string>();
  private resolver: AssetResolver | null = null;

  static normalizePath(path: string): string {
    return path.replace(/\\/g, "/").replace(/^\.?\/+/, "");
  }

  static async fetchText(url: string): Promise<string> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  override register(path: string, content: string): void {
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

  override registerAll(assets: Record<string, string>): void {
    for (const [path, content] of Object.entries(assets)) {
      this.register(path, content);
    }
  }

  override get(path: string): string | undefined {
    const norm = AppAssetStore.normalizePath(path);
    if (this.assets.has(norm)) return this.assets.get(norm);
    const slash = norm.lastIndexOf("/");
    if (slash !== -1) {
      const base = norm.slice(slash + 1);
      if (this.assets.has(base)) return this.assets.get(base);
    }
    return undefined;
  }

  override clear(): void {
    this.assets.clear();
  }

  setResolver(resolver: AssetResolver | null): void {
    this.resolver = resolver
      ? (path) => Promise.resolve(resolver(path))
      : null;
  }

  override async load(url: string): Promise<string> {
    if (URL.canParse(url)) {
      return AppAssetStore.fetchText(url);
    }

    const cleanPath = AppAssetStore.normalizePath(url);

    if (this.resolver) {
      const result = await Promise.resolve(this.resolver(cleanPath));
      if (result !== undefined) return result;
    }

    const registered = this.get(cleanPath);
    if (registered !== undefined) {
      return registered;
    }

    throw new Error(`App asset not found: ${cleanPath}`);
  }
}

export function normalizeAssetPath(path: string): string {
  return AppAssetStore.normalizePath(path);
}

export function resolveUrl(url: string, baseUrl?: string): string {
  if (URL.canParse(url)) {
    return url;
  }
  if (baseUrl) {
    return new URL(url, baseUrl).href;
  }
  return url;
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

export async function loadAsset(url: string): Promise<string> {
  return AppAssetStore.shared.load(url);
}
