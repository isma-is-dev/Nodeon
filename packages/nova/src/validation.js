// Nova Forms & Validation — @validate types, client+server validation
// Schema-based validation with composable validators

/**
 * Create a validation schema.
 * Usage:
 *   const userSchema = schema({
 *     name: [required(), minLength(2), maxLength(50)],
 *     email: [required(), email()],
 *     age: [optional(), number(), min(0), max(150)],
 *   });
 *   const result = userSchema.validate({ name: "Jo", email: "bad" });
 */
function schema(fields) {
  var fieldNames = Object.keys(fields);

  return {
    validate: function(data) {
      var errors = {};
      var valid = true;
      var cleaned = {};

      for (var i = 0; i < fieldNames.length; i++) {
        var field = fieldNames[i];
        var rules = fields[field];
        var value = data ? data[field] : undefined;
        var fieldErrors = [];
        var isOptional = false;

        for (var j = 0; j < rules.length; j++) {
          var rule = rules[j];
          if (rule._optional) {
            isOptional = true;
            continue;
          }
          if (rule._transform) {
            value = rule._transform(value);
            continue;
          }
          var result = rule(value, field, data);
          if (result !== true && result !== null && result !== undefined) {
            fieldErrors.push(typeof result === "string" ? result : result.message || "Invalid");
          }
        }

        if (isOptional && (value === undefined || value === null || value === "")) {
          continue;
        }

        if (fieldErrors.length > 0) {
          errors[field] = fieldErrors;
          valid = false;
        } else {
          cleaned[field] = value;
        }
      }

      return { valid: valid, errors: errors, data: cleaned };
    },

    /**
     * Validate and throw if invalid.
     */
    assert: function(data) {
      var result = this.validate(data);
      if (!result.valid) {
        var err = new Error("Validation failed");
        err.errors = result.errors;
        throw err;
      }
      return result.data;
    },

    /**
     * Get field names.
     */
    fields: function() { return fieldNames.slice(); },
  };
}

// ── Validators ──────────────────────────────────────────────────

function required(msg) {
  return function requiredValidator(value, field) {
    if (value === undefined || value === null || value === "") {
      return msg || field + " is required";
    }
    return true;
  };
}

function optional() {
  var fn = function() { return true; };
  fn._optional = true;
  return fn;
}

function minLength(n, msg) {
  return function minLengthValidator(value, field) {
    if (typeof value === "string" && value.length < n) {
      return msg || field + " must be at least " + n + " characters";
    }
    if (Array.isArray(value) && value.length < n) {
      return msg || field + " must have at least " + n + " items";
    }
    return true;
  };
}

function maxLength(n, msg) {
  return function maxLengthValidator(value, field) {
    if (typeof value === "string" && value.length > n) {
      return msg || field + " must be at most " + n + " characters";
    }
    if (Array.isArray(value) && value.length > n) {
      return msg || field + " must have at most " + n + " items";
    }
    return true;
  };
}

function min(n, msg) {
  return function minValidator(value, field) {
    if (typeof value === "number" && value < n) {
      return msg || field + " must be at least " + n;
    }
    return true;
  };
}

function max(n, msg) {
  return function maxValidator(value, field) {
    if (typeof value === "number" && value > n) {
      return msg || field + " must be at most " + n;
    }
    return true;
  };
}

function email(msg) {
  var emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return function emailValidator(value, field) {
    if (typeof value === "string" && !emailRegex.test(value)) {
      return msg || field + " must be a valid email address";
    }
    return true;
  };
}

function pattern(regex, msg) {
  return function patternValidator(value, field) {
    if (typeof value === "string" && !regex.test(value)) {
      return msg || field + " has an invalid format";
    }
    return true;
  };
}

function number(msg) {
  return function numberValidator(value, field) {
    if (typeof value !== "number" || isNaN(value)) {
      return msg || field + " must be a number";
    }
    return true;
  };
}

function string(msg) {
  return function stringValidator(value, field) {
    if (typeof value !== "string") {
      return msg || field + " must be a string";
    }
    return true;
  };
}

function boolean(msg) {
  return function booleanValidator(value, field) {
    if (typeof value !== "boolean") {
      return msg || field + " must be a boolean";
    }
    return true;
  };
}

function oneOf(values, msg) {
  return function oneOfValidator(value, field) {
    if (!values.includes(value)) {
      return msg || field + " must be one of: " + values.join(", ");
    }
    return true;
  };
}

function url(msg) {
  return function urlValidator(value, field) {
    try {
      new URL(value);
      return true;
    } catch (e) {
      return msg || field + " must be a valid URL";
    }
  };
}

function matches(otherField, msg) {
  return function matchesValidator(value, field, data) {
    if (data && value !== data[otherField]) {
      return msg || field + " must match " + otherField;
    }
    return true;
  };
}

function custom(fn, msg) {
  return function customValidator(value, field, data) {
    var result = fn(value, data);
    if (result === false) {
      return msg || field + " is invalid";
    }
    if (typeof result === "string") return result;
    return true;
  };
}

// ── Transformers ────────────────────────────────────────────────

function trim() {
  var fn = function() { return true; };
  fn._transform = function(v) { return typeof v === "string" ? v.trim() : v; };
  return fn;
}

function toLowerCase() {
  var fn = function() { return true; };
  fn._transform = function(v) { return typeof v === "string" ? v.toLowerCase() : v; };
  return fn;
}

function toNumber() {
  var fn = function() { return true; };
  fn._transform = function(v) {
    var n = Number(v);
    return isNaN(n) ? v : n;
  };
  return fn;
}

function defaultValue(val) {
  var fn = function() { return true; };
  fn._transform = function(v) {
    return (v === undefined || v === null || v === "") ? val : v;
  };
  return fn;
}

// ── Validation Middleware ────────────────────────────────────────

/**
 * Create a middleware that validates request body against a schema.
 */
function validateBody(validationSchema) {
  return function validateBodyMiddleware(req, res, next) {
    var result = validationSchema.validate(req.body || {});
    if (!result.valid) {
      res.writeHead(422, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Validation failed", errors: result.errors }));
      return;
    }
    req.validatedBody = result.data;
    next();
  };
}

/**
 * Create a middleware that validates query parameters against a schema.
 */
function validateQuery(validationSchema) {
  return function validateQueryMiddleware(req, res, next) {
    var url = new URL(req.url, "http://localhost");
    var query = {};
    url.searchParams.forEach(function(value, key) { query[key] = value; });
    var result = validationSchema.validate(query);
    if (!result.valid) {
      res.writeHead(422, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Validation failed", errors: result.errors }));
      return;
    }
    req.validatedQuery = result.data;
    next();
  };
}

module.exports = {
  schema,
  required,
  optional,
  minLength,
  maxLength,
  min,
  max,
  email,
  pattern,
  number,
  string,
  boolean,
  oneOf,
  url,
  matches,
  custom,
  trim,
  toLowerCase,
  toNumber,
  defaultValue,
  validateBody,
  validateQuery,
};
