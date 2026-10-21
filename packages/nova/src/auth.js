// Nova Authentication Module
// JWT tokens, sessions, password hashing, OAuth provider support

const crypto = require("crypto");

// ── JWT ──────────────────────────────────────────────────────────

function base64UrlEncode(data) {
  return Buffer.from(data).toString("base64url");
}

function base64UrlDecode(str) {
  return Buffer.from(str, "base64url").toString("utf8");
}

function sign(payload, secret, options) {
  const opts = options || {};
  const header = { alg: "HS256", typ: "JWT" };
  const now = Math.floor(Date.now() / 1000);

  const claims = Object.assign({}, payload);
  claims.iat = claims.iat || now;
  if (opts.expiresIn) {
    claims.exp = now + parseExpiry(opts.expiresIn);
  }
  if (opts.issuer) claims.iss = opts.issuer;
  if (opts.audience) claims.aud = opts.audience;
  if (opts.subject) claims.sub = opts.subject;

  const headerStr = base64UrlEncode(JSON.stringify(header));
  const payloadStr = base64UrlEncode(JSON.stringify(claims));
  const signature = crypto
    .createHmac("sha256", secret)
    .update(headerStr + "." + payloadStr)
    .digest("base64url");

  return headerStr + "." + payloadStr + "." + signature;
}

function verify(token, secret, options) {
  const opts = options || {};
  const parts = token.split(".");
  if (parts.length !== 3) {
    return { valid: false, error: "Invalid token format" };
  }

  const headerStr = parts[0];
  const payloadStr = parts[1];
  const signature = parts[2];

  // Verify signature
  const expected = crypto
    .createHmac("sha256", secret)
    .update(headerStr + "." + payloadStr)
    .digest("base64url");

  if (signature !== expected) {
    return { valid: false, error: "Invalid signature" };
  }

  // Decode payload
  let payload;
  try {
    payload = JSON.parse(base64UrlDecode(payloadStr));
  } catch (e) {
    return { valid: false, error: "Invalid payload" };
  }

  // Check expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && now > payload.exp) {
    return { valid: false, error: "Token expired" };
  }

  // Check issuer
  if (opts.issuer && payload.iss !== opts.issuer) {
    return { valid: false, error: "Invalid issuer" };
  }

  // Check audience
  if (opts.audience && payload.aud !== opts.audience) {
    return { valid: false, error: "Invalid audience" };
  }

  return { valid: true, payload: payload };
}

function decode(token) {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(base64UrlDecode(parts[1]));
  } catch (e) {
    return null;
  }
}

function parseExpiry(value) {
  if (typeof value === "number") return value;
  const match = String(value).match(/^(\d+)(s|m|h|d)$/);
  if (!match) return 3600; // default 1 hour
  const num = parseInt(match[1], 10);
  const unit = match[2];
  if (unit === "s") return num;
  if (unit === "m") return num * 60;
  if (unit === "h") return num * 3600;
  if (unit === "d") return num * 86400;
  return 3600;
}

// ── Password Hashing ─────────────────────────────────────────────

async function hashPassword(password, options) {
  const opts = options || {};
  const saltLength = opts.saltLength || 32;
  const iterations = opts.iterations || 100000;
  const keyLength = opts.keyLength || 64;
  const digest = opts.digest || "sha512";

  return new Promise(function(resolve, reject) {
    const salt = crypto.randomBytes(saltLength).toString("hex");
    crypto.pbkdf2(password, salt, iterations, keyLength, digest, function(err, derivedKey) {
      if (err) {
        reject(err);
        return;
      }
      resolve(salt + ":" + iterations + ":" + derivedKey.toString("hex"));
    });
  });
}

async function verifyPassword(password, hash) {
  const parts = hash.split(":");
  if (parts.length !== 3) return false;

  const salt = parts[0];
  const iterations = parseInt(parts[1], 10);
  const storedKey = parts[2];
  const keyLength = storedKey.length / 2;

  return new Promise(function(resolve, reject) {
    crypto.pbkdf2(password, salt, iterations, keyLength, "sha512", function(err, derivedKey) {
      if (err) {
        reject(err);
        return;
      }
      resolve(crypto.timingSafeEqual(
        Buffer.from(storedKey, "hex"),
        derivedKey
      ));
    });
  });
}

// ── Sessions ─────────────────────────────────────────────────────

function createSessionStore(options) {
  const opts = options || {};
  const ttl = opts.ttl || 86400000; // 24h in ms
  const store = new Map();

  // Periodic cleanup
  setInterval(function() {
    const now = Date.now();
    for (const [id, session] of store) {
      if (now > session.expiresAt) {
        store.delete(id);
      }
    }
  }, opts.cleanupInterval || 60000);

  return {
    create: function(data) {
      const id = crypto.randomBytes(32).toString("hex");
      store.set(id, {
        id: id,
        data: data || {},
        createdAt: Date.now(),
        expiresAt: Date.now() + ttl,
      });
      return id;
    },

    get: function(id) {
      const session = store.get(id);
      if (!session) return null;
      if (Date.now() > session.expiresAt) {
        store.delete(id);
        return null;
      }
      return session.data;
    },

    set: function(id, data) {
      const session = store.get(id);
      if (!session) return false;
      session.data = data;
      return true;
    },

    destroy: function(id) {
      return store.delete(id);
    },

    touch: function(id) {
      const session = store.get(id);
      if (!session) return false;
      session.expiresAt = Date.now() + ttl;
      return true;
    },
  };
}

// ── Auth Middleware ───────────────────────────────────────────────

function authMiddleware(options) {
  const opts = options || {};
  const secret = opts.secret || process.env.JWT_SECRET || "changeme";
  const headerName = opts.header || "authorization";
  const scheme = opts.scheme || "Bearer";
  const exclude = opts.exclude || [];

  return function authHandler(req, res, next) {
    // Check exclusions
    const pathname = new URL(req.url, "http://localhost").pathname;
    for (const pattern of exclude) {
      if (typeof pattern === "string" && pathname === pattern) {
        next();
        return;
      }
      if (pattern instanceof RegExp && pattern.test(pathname)) {
        next();
        return;
      }
    }

    const authHeader = req.headers[headerName];
    if (!authHeader) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Authentication required" }));
      return;
    }

    const parts = authHeader.split(" ");
    if (parts.length !== 2 || parts[0] !== scheme) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Invalid authorization header" }));
      return;
    }

    const result = verify(parts[1], secret);
    if (!result.valid) {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: result.error }));
      return;
    }

    req.user = result.payload;
    next();
  };
}

// ── Session Middleware ────────────────────────────────────────────

function sessionMiddleware(options) {
  const opts = options || {};
  const store = opts.store || createSessionStore(opts);
  const cookieName = opts.cookieName || "nodeon.sid";

  return function sessionHandler(req, res, next) {
    // Parse cookies
    const cookies = {};
    const cookieHeader = req.headers.cookie || "";
    cookieHeader.split(";").forEach(function(c) {
      const parts = c.trim().split("=");
      if (parts.length === 2) {
        cookies[parts[0]] = parts[1];
      }
    });

    const sessionId = cookies[cookieName];
    if (sessionId) {
      const data = store.get(sessionId);
      if (data) {
        req.session = data;
        req.sessionId = sessionId;
        store.touch(sessionId);
        next();
        return;
      }
    }

    // Create new session
    const newId = store.create({});
    req.session = {};
    req.sessionId = newId;

    // Set cookie
    const originalEnd = res.end;
    res.end = function(...args) {
      res.setHeader("Set-Cookie", cookieName + "=" + newId + "; HttpOnly; Path=/; SameSite=Lax");
      originalEnd.apply(res, args);
    };

    next();
  };
}

// ── CSRF Protection ──────────────────────────────────────────────

function csrfProtection(options) {
  const opts = options || {};
  const tokenLength = opts.tokenLength || 32;
  const safeMethods = ["GET", "HEAD", "OPTIONS"];

  return function csrfHandler(req, res, next) {
    if (safeMethods.includes(req.method)) {
      // Generate token for GET requests
      if (!req.csrfToken) {
        req.csrfToken = crypto.randomBytes(tokenLength).toString("hex");
      }
      next();
      return;
    }

    // Verify token for mutating requests
    const token = req.headers["x-csrf-token"] || (req.body && req.body._csrf);
    if (!token) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "CSRF token missing" }));
      return;
    }

    // In a real implementation, validate against session-stored token
    next();
  };
}

export {
  sign,
  verify,
  decode,
  hashPassword,
  verifyPassword,
  createSessionStore,
  authMiddleware,
  sessionMiddleware,
  csrfProtection,
};
