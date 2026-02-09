export class DataClawError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = "DataClawError";
  }
}
