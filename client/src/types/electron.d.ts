export {};

declare global {
  interface Window {
    myFitnessPlan?: {
      /** Opens a native folder dialog; resolves to an absolute path or null if cancelled. */
      pickDirectory: () => Promise<string | null>;
      /** Show a folder in Finder / Explorer. Older desktop builds don't have it. */
      openFolder?: (folder: string) => Promise<boolean>;
    };
  }
}
