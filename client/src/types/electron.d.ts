export {};

declare global {
  interface Window {
    myFitnessPlan?: {
      /** Opens a native folder dialog; resolves to an absolute path or null if cancelled. */
      pickDirectory: () => Promise<string | null>;
    };
  }
}
