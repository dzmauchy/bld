const SOURCE_PATTERN = /\.(c|cc|cpp|cxx|C)$/;
const HEADER_PATTERN = /\.(h|hh|hpp|hxx|inc)$/;

export function normalizeRelativePath(relative: string): string {
  const cleaned = relative.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!cleaned || cleaned.split("/").includes("..")) {
    throw new Error(`invalid virtual path: ${relative}`);
  }
  return cleaned;
}

export function workPath(relative: string): string {
  return `/work/${normalizeRelativePath(relative)}`;
}

export function objectPathFor(relative: string): string {
  const normalized = normalizeRelativePath(relative);
  const dot = normalized.lastIndexOf(".");
  const stem = dot === -1 ? normalized : normalized.slice(0, dot);
  return `/work/${stem}.o`;
}

export function isCppSource(relative: string): boolean {
  return SOURCE_PATTERN.test(normalizeRelativePath(relative));
}

export function isHeader(relative: string): boolean {
  return HEADER_PATTERN.test(normalizeRelativePath(relative));
}

export function parentDir(path: string): string {
  const idx = path.lastIndexOf("/");
  if (idx <= 0) return "/";
  return path.slice(0, idx);
}

export function joinPath(base: string, name: string): string {
  if (base === "/") return `/${name}`;
  return `${base.replace(/\/$/, "")}/${name}`;
}
