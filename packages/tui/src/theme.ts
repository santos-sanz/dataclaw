export type ThemeName = "vivid";
export type CompatibilityMode = "auto" | "unicode" | "ascii";

export interface ThemeContext {
  name: ThemeName;
  useColor: boolean;
  useUnicode: boolean;
  width: number;
}

export interface Theme {
  name: ThemeName;
  context: ThemeContext;
  symbols: {
    info: string;
    success: string;
    warn: string;
    error: string;
    bullet: string;
    prompt: string;
  };
  borders: {
    horizontal: string;
    vertical: string;
    topLeft: string;
    topRight: string;
    bottomLeft: string;
    bottomRight: string;
  };
  style: {
    accent: (text: string) => string;
    success: (text: string) => string;
    warn: (text: string) => string;
    error: (text: string) => string;
    muted: (text: string) => string;
  };
}

export interface ThemeResolutionOptions {
  compatibility?: CompatibilityMode;
  isTTY?: boolean;
  columns?: number;
  env?: NodeJS.ProcessEnv;
  name?: ThemeName;
}

const MIN_WIDTH = 60;
const DEFAULT_WIDTH = 100;
const MAX_WIDTH = 160;

const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  cyan: "\u001b[36m",
};

export function resolveThemeContext(options: ThemeResolutionOptions = {}): ThemeContext {
  const env = options.env ?? process.env;
  const compatibility = options.compatibility ?? "auto";
  const isTTY = options.isTTY ?? Boolean(process.stdout.isTTY);
  const width = clamp(options.columns ?? process.stdout.columns ?? DEFAULT_WIDTH, MIN_WIDTH, MAX_WIDTH);
  const useColor = isTTY && !("NO_COLOR" in env);
  const useUnicode = resolveUnicodeSupport(compatibility, isTTY, env);

  return {
    name: options.name ?? "vivid",
    useColor,
    useUnicode,
    width,
  };
}

export function buildTheme(context: ThemeContext): Theme {
  return {
    name: context.name,
    context,
    symbols: context.useUnicode
      ? {
          info: "i",
          success: "✓",
          warn: "!",
          error: "✗",
          bullet: "•",
          prompt: "❯",
        }
      : {
          info: "i",
          success: "v",
          warn: "!",
          error: "x",
          bullet: "-",
          prompt: ">",
        },
    borders: context.useUnicode
      ? {
          horizontal: "─",
          vertical: "│",
          topLeft: "┌",
          topRight: "┐",
          bottomLeft: "└",
          bottomRight: "┘",
        }
      : {
          horizontal: "-",
          vertical: "|",
          topLeft: "+",
          topRight: "+",
          bottomLeft: "+",
          bottomRight: "+",
        },
    style: {
      accent: (text) => colorize(text, `${ANSI.bold}${ANSI.cyan}`, context.useColor),
      success: (text) => colorize(text, `${ANSI.bold}${ANSI.green}`, context.useColor),
      warn: (text) => colorize(text, `${ANSI.bold}${ANSI.yellow}`, context.useColor),
      error: (text) => colorize(text, `${ANSI.bold}${ANSI.red}`, context.useColor),
      muted: (text) => colorize(text, ANSI.dim, context.useColor),
    },
  };
}

function resolveUnicodeSupport(
  compatibility: CompatibilityMode,
  isTTY: boolean,
  env: NodeJS.ProcessEnv,
): boolean {
  if (compatibility === "unicode") return true;
  if (compatibility === "ascii") return false;
  if (!isTTY) return false;
  return (env.TERM ?? "").toLowerCase() !== "dumb";
}

function colorize(text: string, prefix: string, enabled: boolean): string {
  if (!enabled) return text;
  return `${prefix}${text}${ANSI.reset}`;
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}
