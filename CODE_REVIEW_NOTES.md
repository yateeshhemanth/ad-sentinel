# Code Review Notes (Bugs + Enhancements)

This review focuses on high-impact backend/frontend reliability and production-hardening issues observed in the current codebase.

## Confirmed Bugs / Risks

1. **CORS policy is too permissive in production**
   - `server.js` always allows any `http://localhost:*` origin regardless of environment.
   - This is convenient for dev, but risky in production if misconfigured ingress permits those origins.
   - **Where**: `backend/server.js` origin callback checks localhost unconditionally.

2. **Bootstrap path has no top-level failure guard**
   - Startup sequence uses an async IIFE without a surrounding `try/catch`.
   - If `connectDB()` or `connectRedis()` throws unexpectedly, process failure relies on unhandled rejection behavior and may log poorly.
   - **Where**: `backend/server.js` bootstrap IIFE.

3. **Bulk customer endpoint does not apply full field-level validation per item**
   - `/customers/bulk` validates only that `customers` is an array, then only checks `name/domain` presence.
   - Invalid `ldap_port`, malformed domain/URL, and oversized fields can pass deeper into DB logic.
   - **Where**: `backend/routes/customers.js` bulk route.

4. **Frontend API helper returns `undefined` on 401 rather than rejecting**
   - `request()` clears auth + redirects, then `return`s (undefined).
   - Callers awaiting a value may proceed with inconsistent state if redirect is delayed/blocked.
   - **Where**: `frontend/src/utils/api.js` request helper.

5. **Change-password policy is weaker than reset-password policy**
   - `change-password` enforces only min length 8, while `reset-password` enforces uppercase/number/special checks.
   - This introduces policy inconsistency and a weaker authenticated-path password quality guarantee.
   - **Where**: `backend/routes/auth.js` validators.

6. **Silent parse failure for `audit_params` masks config corruption**
   - JSON parse errors for `audit_params` are swallowed (`catch {}`), making misconfiguration invisible.
   - This can lead to scans running with defaults unexpectedly.
   - **Where**: `backend/services/scanEngine.js` audit params loading.

## Enhancements Recommended

1. **Make CORS environment-aware**
   - Allow wildcard localhost only in non-production.
   - In production, enforce exact allowed origins list from env.

2. **Add explicit bootstrap error handling**
   - Wrap startup with `try/catch`; log fatal reason and `process.exit(1)`.

3. **Introduce shared customer payload validator for all write paths**
   - Reuse strict validation for `POST /customers`, `PATCH /customers/:id`, and each item in `POST /customers/bulk`.

4. **Use a consistent API error contract on auth expiry**
   - On 401, redirect but still reject promise (or throw typed error) so caller flow remains deterministic.

5. **Unify password complexity policy**
   - Reuse the same validation rules for both reset and change routes.
   - Optionally reject password reuse (new == current).

6. **Log invalid `audit_params` JSON**
   - Replace silent catch with warning-level structured logging and fallback defaults.

7. **Add API-level tests around critical routes**
   - Priority: `/auth/change-password`, `/customers/bulk`, `/settings` validation.

## Suggested Priority

- **P0**: CORS prod hardening, startup failure handling, bulk validation gaps.
- **P1**: 401 request behavior consistency, password policy parity.
- **P2**: observability improvements (`audit_params` warnings), route tests and contract tests.
