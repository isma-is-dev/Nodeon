// Nova Middleware Pipeline
// Composable middleware with CORS, rate limiting, body parsing, logging

/**
 * Create a middleware pipeline that runs handlers in order.
 * Each handler receives (req, res, next). Call next() to continue.
 */
function createPipeline(...handlers) {
  return function runPipeline(req, res, done) {
    let idx = 0;
    function next(err) {
      if (err) {
        if (done) done(err);
        else {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: err.message || "Internal Server Error" }));
        }
        return;
      }
      if (idx >= handlers.length) {
        if (done) done();
        return;
      }
      const handler = handlers[idx++];
      try {
        handler(req, res, next);
      } catch (e) {
        next(e);
      }
    }
    next();
  };
}

/**
 * CORS middleware
 */
function cors(options) {
  const opts = options || {};
  const origin = opts.origin || "*";
  const methods = opts.methods || "GET,HEAD,PUT,PATCH,POST,DELETE";
  const headers = opts.headers || "Content-Type,Authorization";
  const credentials = opts.credentials || false;
  const maxAge = opts.maxAge || 86400;

  return function corsHandler(req, res, next) {
    const reqOrigin = req.headers.origin;

    // Determine allowed origin
    let allowedOrigin = "*";
    if (typeof origin === "function") {
      allowedOrigin = origin(reqOrigin) ? reqOrigin : false;
    } else if (Array.isArray(origin)) {
      allowedOrigin = origin.includes(reqOrigin) ? reqOrigin : false;
    } else if (origin !== "*") {
      allowedOrigin = origin;
    }

    if (allowedOrigin === false) {
      next();
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Access-Control-Allow-Methods", methods);
    res.setHeader("Access-Control-Allow-Headers", headers);
    if (credentials) {
      res.setHeader("Access-Control-Allow-Credentials", "true");
    }

    // Preflight
    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Max-Age", String(maxAge));
      res.writeHead(204);
      res.end();
      return;
    }

    next();
  };
}

/**
 * Rate limiting middleware — in-memory token bucket
 */
function rateLimit(options) {
  const opts = options || {};
  const windowMs = opts.windowMs || 60000;
  const max = opts.max || 100;
  const message = opts.message || "Too many requests";
  const keyFn = opts.keyFn || function(req) {
    return req.socket.remoteAddress || "unknown";
  };

  const store = new Map();

  // Cleanup expired entries periodically
  setInterval(function() {
    const now = Date.now();
    for (const [key, entry] of store) {
      if (now - entry.resetTime > windowMs) {
        store.delete(key);
      }
    }
  }, windowMs);

  return function rateLimitHandler(req, res, next) {
    const key = keyFn(req);
    const now = Date.now();

    let entry = store.get(key);
    if (!entry || now > entry.resetTime) {
      entry = { count: 0, resetTime: now + windowMs };
      store.set(key, entry);
    }

    entry.count++;

    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - entry.count)));
    res.setHeader("X-RateLimit-Reset", String(Math.ceil(entry.resetTime / 1000)));

    if (entry.count > max) {
      res.writeHead(429, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: message }));
      return;
    }

    next();
  };
}

/**
 * JSON body parser middleware
 */
function jsonBody(options) {
  const opts = options || {};
  const limit = opts.limit || 1024 * 1024; // 1MB default

  return function jsonBodyHandler(req, res, next) {
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      next();
      return;
    }

    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("application/json")) {
      next();
      return;
    }

    let body = "";
    req.on("data", function(chunk) {
      body += chunk;
      if (body.length > limit) {
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Payload too large" }));
        req.destroy();
      }
    });
    req.on("end", function() {
      try {
        req.body = JSON.parse(body);
        next();
      } catch (e) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
    });
  };
}

/**
 * Request logging middleware
 */
function logger(options) {
  const opts = options || {};
  const format = opts.format || "short";

  return function loggerHandler(req, res, next) {
    const start = Date.now();
    const method = req.method;
    const url = req.url;

    const originalEnd = res.end;
    res.end = function(...args) {
      const duration = Date.now() - start;
      const status = res.statusCode;
      const color = status >= 500 ? "\x1b[31m" : status >= 400 ? "\x1b[33m" : status >= 300 ? "\x1b[36m" : "\x1b[32m";

      if (format === "short") {
        console.log("  " + color + method + "\x1b[0m " + url + " " + color + status + "\x1b[0m " + duration + "ms");
      } else {
        console.log("  " + new Date().toISOString() + " " + color + method + "\x1b[0m " + url + " " + color + status + "\x1b[0m " + duration + "ms");
      }

      originalEnd.apply(res, args);
    };

    next();
  };
}

/**
 * Security headers middleware
 */
function securityHeaders(options) {
  const opts = options || {};

  return function securityHandler(req, res, next) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", opts.frameOptions || "DENY");
    res.setHeader("X-XSS-Protection", "1; mode=block");
    res.setHeader("Referrer-Policy", opts.referrerPolicy || "strict-origin-when-cross-origin");
    if (opts.hsts !== false) {
      res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    }
    if (opts.csp) {
      res.setHeader("Content-Security-Policy", opts.csp);
    }
    next();
  };
}

export {
  createPipeline,
  cors,
  rateLimit,
  jsonBody,
  logger,
  securityHeaders,
};
