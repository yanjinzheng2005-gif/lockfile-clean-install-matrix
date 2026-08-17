export class UsageError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'UsageError';
  }
}

export class BoundaryError extends Error {
  /** @param {string} message @param {string[]} [details] */
  constructor(message, details = []) {
    super(message);
    this.name = 'BoundaryError';
    this.details = details;
  }
}

export class EnvironmentError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'EnvironmentError';
  }
}
