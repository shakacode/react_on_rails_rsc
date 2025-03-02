// we don't care about options, so don't specify the type here
export const createFromFetch: <T>(res: Promise<Response>, options?: {}) => Promise<T>;

export const createFromReadableStream: <T>(stream: ReadableStream, options?: {}) => Promise<T>;
