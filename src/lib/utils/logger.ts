type LogMeta = Record<string, unknown>;

export const logger = {
  info(message: string, meta?: LogMeta) {
    console.info(message, meta ?? "");
  },
  warn(message: string, meta?: LogMeta) {
    console.warn(message, meta ?? "");
  },
  error(message: string, meta?: LogMeta) {
    console.error(message, meta ?? "");
  }
};
