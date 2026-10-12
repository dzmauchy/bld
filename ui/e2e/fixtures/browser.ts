export { expect, element, dialog, baseURL, fetchAsset, artifactPath, type BrowserElement, type Page } from "../../../tests/e2e/browser.ts";
import { browserTest } from "../../../tests/e2e/browser.ts";
export const test = browserTest();
export const stockTest = browserTest(true);
