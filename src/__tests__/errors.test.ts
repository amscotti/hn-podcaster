import { assertEquals } from "@std/assert";
import {
  ApiError,
  ConfigurationError,
  PodcastGenerationError,
  ValidationError,
} from "../shared/errors.ts";

Deno.test("PodcastGenerationError - basic functionality", () => {
  const error = new PodcastGenerationError("Test error message");
  assertEquals(error.message, "Test error message");
  assertEquals(error.name, "PodcastGenerationError");
});

Deno.test("PodcastGenerationError - with cause", () => {
  const cause = new Error("Original error");
  const error = new PodcastGenerationError("Wrapped error", cause);

  assertEquals(error.message, "Wrapped error");
  assertEquals(error.cause, cause);
});

Deno.test("ApiError - with status code", () => {
  const cause = new Error("Network error");
  const error = new ApiError("API request failed", 500, cause);

  assertEquals(error.message, "API request failed");
  assertEquals(error.name, "ApiError");
  assertEquals(error.statusCode, 500);
  assertEquals(error.cause, cause);
});

Deno.test("ValidationError - with field", () => {
  const error = new ValidationError("Invalid input", "email");

  assertEquals(error.message, "Invalid input");
  assertEquals(error.name, "ValidationError");
  assertEquals(error.field, "email");
});

Deno.test("ConfigurationError - inheritance", () => {
  const error = new ConfigurationError("Config missing");

  assertEquals(error.message, "Config missing");
  assertEquals(error.name, "ConfigurationError");
  assertEquals(error instanceof PodcastGenerationError, true);
});

Deno.test("Error hierarchy - instanceof checks", () => {
  const apiError = new ApiError("API error");
  const validationError = new ValidationError("Validation error");
  const configError = new ConfigurationError("Config error");

  // All should be instanceof PodcastGenerationError
  assertEquals(apiError instanceof PodcastGenerationError, true);
  assertEquals(validationError instanceof PodcastGenerationError, true);
  assertEquals(configError instanceof PodcastGenerationError, true);

  // Specific types should be instanceof their parent
  assertEquals(apiError instanceof Error, true);
  assertEquals(validationError instanceof Error, true);
  assertEquals(configError instanceof Error, true);
});

Deno.test("Error serialization", () => {
  const cause = new Error("Test cause");
  const error = new ApiError("Test error", 404, cause);
  const serialized = JSON.stringify(error);

  // Should include all properties
  const parsed = JSON.parse(serialized);
  assertEquals(parsed.name, "ApiError");
  assertEquals(parsed.message, "Test error");
  assertEquals(parsed.cause, "Test cause"); // Now properly serialized
});
