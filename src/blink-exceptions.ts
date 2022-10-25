export class BlinkException extends Error {
  constructor(message: string) {
    super(message);
  }
}

export class BlinkAuthenticationException extends BlinkException {
  constructor(message: string) {
    super(message);
  }
}
