import { configure, getConsoleSink, getLogger } from "@logtape/logtape";
import { getPrettyFormatter } from "@logtape/pretty";

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
      lowestLevel: "info",
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
