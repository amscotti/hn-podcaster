import { configure, getConsoleSink, getLogger } from "@logtape/logtape";
import { prettyFormatter } from "@logtape/pretty";

// Configure LogTape with pretty formatting for CLI
await configure({
  sinks: {
    console: getConsoleSink({ formatter: prettyFormatter }),
  },
  loggers: [
    {
      category: ["podcast-generator"],
      lowestLevel: "info",
      sinks: ["console"],
    },
    {
      category: ["podcast-generator", "debug"],
      lowestLevel: "debug",
      sinks: ["console"],
    },
  ],
});

// Export the configured logger for use throughout the app
export const logger = getLogger(["podcast-generator"]);
