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
    if (slash !== -1 && !this.assets.has(norm.slice(slash + 1))) {
      this.assets.set(norm.slice(slash + 1), content);
    }
  }

  override registerAll(assets: Record<string, string>): void {
    Object.entries(assets).forEach(([p, c]) => this.register(p, c));
  }

  override get(path: string): string | undefined {
    const norm = AppAssetStore.normalizePath(path);
    const slash = norm.lastIndexOf("/");
    return this.assets.get(norm) ?? (slash !== -1 ? this.assets.get(norm.slice(slash + 1)) : undefined);
  }

  override clear(): void {
    this.assets.clear();
  }

  setResolver(resolver: AssetResolver | null): void {
    this.resolver = resolver ? (path) => Promise.resolve(resolver(path)) : null;
  }

  override async load(url: string): Promise<string> {
    if (URL.canParse(url)) return AppAssetStore.fetchText(url);
    const cleanPath = AppAssetStore.normalizePath(url);
    if (this.resolver) {
      const result = await Promise.resolve(this.resolver(cleanPath));
      if (result !== undefined) return result;
    }
    const registered = this.get(cleanPath);
    if (registered !== undefined) return registered;
    throw new Error(`App asset not found: ${cleanPath}`);
  }
}

export const normalizeAssetPath = (path: string): string => AppAssetStore.normalizePath(path);
export const resolveUrl = (url: string, baseUrl?: string): string =>
  URL.canParse(url) ? url : baseUrl ? new URL(url, baseUrl).href : url;
export const registerAppAsset = (path: string, content: string): void => AppAssetStore.shared.register(path, content);
export const registerAppAssets = (assets: Record<string, string>): void => AppAssetStore.shared.registerAll(assets);
export const getRegisteredAppAsset = (path: string): string | undefined => AppAssetStore.shared.get(path);
export const clearRegisteredAppAssets = (): void => AppAssetStore.shared.clear();
export const setAppAssetResolver = (resolver: AssetResolver | null): void => AppAssetStore.shared.setResolver(resolver);
export const fetchText = (url: string): Promise<string> => AppAssetStore.fetchText(url);
export const loadAsset = (url: string): Promise<string> => AppAssetStore.shared.load(url);
