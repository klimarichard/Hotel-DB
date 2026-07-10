/**
 * Make Express 4 forward async route-handler rejections to the error middleware.
 *
 * Express 4 predates async handlers: `Layer.handle_request` calls the handler in
 * a `try/catch` that only catches SYNCHRONOUS throws. When an `async` handler
 * rejects, the returned promise is dropped on the floor — no response is ever
 * sent and the client's request hangs until it times out (the "Ukládám…" that
 * never finishes). Historically every handler had to wrap its own body in
 * try/catch and call `next(err)`; across ~200 handlers that is impossible to keep
 * consistent, and one miss is a silent hang.
 *
 * This installs the fix once, globally: it wraps `Layer.prototype.handle_request`
 * / `handle_error` so that when a handler returns a thenable, its rejection is
 * routed to `next()` — reaching the JSON-500 error middleware in `index.ts`.
 * This is the same mechanism the well-known `express-async-errors` package uses,
 * reimplemented locally so we add no Cloud Functions dependency.
 *
 * It reaches into an Express internal module path (`express/lib/router/layer`),
 * which has no public API. If a future Express version moves or reshapes that
 * module, the patch quietly no-ops (leaving the stock behavior) rather than
 * crashing app startup — so an upgrade can never take the whole API down, it can
 * only reintroduce the original hang-on-reject risk, which a test guards against.
 *
 * Call `installAsyncRouteErrorForwarding()` once, before the app serves traffic.
 */

import type { Request, Response, NextFunction } from "express";

interface LayerProto {
  handle?: unknown;
  handle_request: (req: Request, res: Response, next: NextFunction) => void;
  handle_error: (err: unknown, req: Request, res: Response, next: NextFunction) => void;
  __asyncErrorsPatched?: boolean;
}

/** Attach a rejection → next(err) forwarder to a thenable returned by a handler. */
function forwardRejection(ret: unknown, next: NextFunction): void {
  if (ret && typeof (ret as { then?: unknown }).then === "function") {
    (ret as Promise<unknown>).then(undefined, next);
  }
}

export function installAsyncRouteErrorForwarding(): void {
  let proto: LayerProto | undefined;
  try {
    // Express 4 exposes no public handle on the Layer; require the internal path.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    proto = (require("express/lib/router/layer") as { prototype: LayerProto }).prototype;
  } catch {
    return; // internal module path changed — leave Express behavior untouched
  }
  if (!proto || proto.__asyncErrorsPatched) return;
  if (typeof proto.handle_request !== "function" || typeof proto.handle_error !== "function") return;
  proto.__asyncErrorsPatched = true;

  const originalRequest = proto.handle_request;
  proto.handle_request = function patchedHandleRequest(this: LayerProto, req, res, next) {
    const fn = this.handle;
    // Only wrap ordinary (req,res,next) handlers; a 4-arg fn is an error handler
    // and is skipped in the request phase, exactly as stock Express does.
    if (typeof fn === "function" && fn.length <= 3) {
      let ret: unknown;
      try {
        ret = (fn as (req: Request, res: Response, next: NextFunction) => unknown).call(this, req, res, next);
      } catch (err) {
        next(err);
        return;
      }
      forwardRejection(ret, next);
      return;
    }
    originalRequest.call(this, req, res, next);
  };

  const originalError = proto.handle_error;
  proto.handle_error = function patchedHandleError(this: LayerProto, error, req, res, next) {
    const fn = this.handle;
    // Only 4-arg error handlers run in the error phase (stock Express rule).
    if (typeof fn === "function" && fn.length === 4) {
      let ret: unknown;
      try {
        ret = (fn as (e: unknown, req: Request, res: Response, next: NextFunction) => unknown).call(
          this,
          error,
          req,
          res,
          next
        );
      } catch (err) {
        next(err);
        return;
      }
      forwardRejection(ret, next);
      return;
    }
    originalError.call(this, error, req, res, next);
  };
}
