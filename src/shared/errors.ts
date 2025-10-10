export class PodcastGenerationError extends Error {
  public override cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "PodcastGenerationError";
    this.cause = cause;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      cause: this.cause instanceof Error ? this.cause.message : this.cause,
    };
  }
}

export class ApiError extends PodcastGenerationError {
  public statusCode?: number;

  constructor(
    message: string,
    statusCode?: number,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "ApiError";
    this.statusCode = statusCode;
  }
}

export class ValidationError extends PodcastGenerationError {
  public field?: string;

  constructor(
    message: string,
    field?: string,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "ValidationError";
    this.field = field;
  }
}

export class ConfigurationError extends PodcastGenerationError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "ConfigurationError";
  }
}
