export class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new HttpError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = '请先登录') => new HttpError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = '没有权限') => new HttpError(403, 'FORBIDDEN', msg);
export const notFound = (msg = '资源不存在') => new HttpError(404, 'NOT_FOUND', msg);
export const conflict = (msg, details) => new HttpError(409, 'CONFLICT', msg, details);

export const asyncHandler = (fn) => (req, res, next) => {
  try {
    const r = fn(req, res, next);
    if (r && typeof r.then === 'function') r.catch(next);
  } catch (err) {
    next(err);
  }
};

export function parseBody(schema, data) {
  const result = schema.safeParse(data ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }));
    throw new HttpError(400, 'VALIDATION_ERROR', details[0]?.path ? `${details[0].path}: ${details[0].message}` : '参数校验失败', details);
  }
  return result.data;
}
