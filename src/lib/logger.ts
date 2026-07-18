import {
  configure,
  getConsoleSink,
  getLogger,
  type LogLevel,
} from "@logtape/logtape";
import { getPrettyFormatter } from "@logtape/pretty";

const LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warning",
  "error",
  "fatal",
] as const satisfies readonly LogLevel[];

/**
 * Resolve LOG_LEVEL from the environment. Invalid values fall back to "info"
 * so a typo never silences all logging or crashes startup.
 */
function resolveLogLevel(): LogLevel {
  const raw = Deno.env.get("LOG_LEVEL")?.toLowerCase().trim();
  if (raw && (LOG_LEVELS as readonly string[]).includes(raw)) {
    return raw as LogLevel;
  }
  if (raw) {
    console.warn(
      `Invalid LOG_LEVEL="${raw}". Expected one of: ${
        LOG_LEVELS.join(", ")
      }. Using "info".`,
    );
  }
  return "info";
}

const logLevel = resolveLogLevel();

// Configure LogTape once at module load using top-level await
await configure({
  sinks: {
    console: getConsoleSink({
      formatter: getPrettyFormatter({
        colors: true,
        icons: false,
      }),
    }),
  },
  loggers: [
    {
      category: ["hn-podcaster"],
      lowestLevel: logLevel,
      sinks: ["console"],
    },
    {
      category: ["logtape", "meta"],
      lowestLevel: "warning",
      sinks: ["console"],
    },
  ],
});

// Get a logger for a specific category
export function getAppLogger(category: string) {
  return getLogger(["hn-podcaster", category]);
}
