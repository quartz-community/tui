declare module "@opentui/core" {
  export type SelectOption = { name: string; description: string; value?: any };
  export type TabSelectOption = {
    name: string;
    description: string;
    value?: any;
  };
  export interface CliRendererOptions {
    exitOnCtrlC?: boolean;
    useAlternateScreen?: boolean;
  }
  export function createCliRenderer(
    options?: CliRendererOptions,
  ): Promise<unknown>;
}

declare module "@opentui/react" {
  export function createRoot(renderer: unknown): {
    render(element: unknown): void;
  };
  export function useKeyboard(
    handler: (event: {
      name: string;
      shift?: boolean;
      ctrl?: boolean;
      meta?: boolean;
      eventType?: string;
      repeated?: boolean;
    }) => void,
  ): void;
  export function useOnResize(
    callback: (width: number, height: number) => void,
  ): void;
  export function useTimeline(options?: {
    duration?: number;
    loop?: boolean;
    autoplay?: boolean;
  }): unknown;
  export function useRenderer(): { destroy(): void; console: { show(): void } };
  export function useTerminalDimensions(): { width: number; height: number };
}
