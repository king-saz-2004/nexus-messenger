# Nexus Messenger - Security & Deployment Best Practices

This document outlines essential security practices for deploying and maintaining Nexus Messenger in a self-hosted or production environment.

## 1. Secrets Management

* **Never Commit `.env` Files**: Environment configuration files contains highly sensitive keys (database passwords, JWT secrets, default administrator credentials). Ensure they are listed in your `.gitignore` and never committed to version control.
* **Rotate Secrets Regularly**: If any credentials (e.g. `JWT_SECRET`, database passwords) were accidentally committed or exposed, change and rotate them immediately.
* **Generate Strong Secrets**: Use cryptographically secure methods to generate all application secrets. For example, you can generate 32-character hexadecimal strings with:
  ```bash
  openssl rand -hex 32
  ```

## 2. Default Administrator Account

* **Bootstrapping**: The default root administrator is bootstrapped on first run using `DEFAULT_ROOT_USERNAME` and `DEFAULT_ROOT_PASSWORD` defined in your `.env` file.
* **Change Password Immediately**: Change the default administrator password immediately after the first login via the Profile settings screen.
* **Reset on Boot**: Set `RESET_ROOT_PASSWORD_ON_BOOT=false` in production. Keeping it `true` resets the password on every container restart, which is a significant security risk.

## 3. Database Security

* **Database-level Access Control**: Ensure that different services use appropriate database users. Do not run the main application using the superuser (`POSTGRES_USER`). Use the app-specific role (`APP_DB_USER`) which is automatically configured with restricted table-level grants.
* **Row-Level Security (RLS)**: Row-Level Security is active on tables like `users`, `sessions`, `contacts`, `user_settings`, `messages`, and `chat_members`. Any custom database modifications or migrations must preserve RLS policies to prevent accidental data leakage or privilege escalation.

## 4. Transport & Cookie Security

* **Enforce HTTPS**: Always run the application behind an SSL/TLS-terminating reverse proxy (e.g., Nginx, Caddy, Cloudflare) in production.
* **Secure Cookies**: Keep `COOKIE_SECURE=true` and `ENFORCE_HTTPS=true` in production to ensure session tokens are only transmitted over secure connections.
* **Strict SameSite**: Configure `COOKIE_SAME_SITE=strict` (or `lax` depending on your domain structure) to prevent CSRF attacks.

## 5. Deployment Security

* **Private Deploy Scripts**: Never publish remote deployment scripts containing server IPs, SSH usernames, or project directories to public repositories. Legacy remote deploy scripts should not be published or used as official deployment paths. Docker Compose is the canonical deployment path.
* **Rate Limiting**: Nexus Messenger has built-in express-rate-limiters for global endpoints and authentication routes. Maintain these limiters in production to prevent brute-force attacks and denial-of-service attempts.

## 6. Message Deletion & Media Cleanup Privacy

* **Hard Delete by Default**: There is no "Delete for me" feature. Any message delete action permanently deletes the message from the active database for everyone.
* **Media Cleanup**: When a message referencing a media file is deleted (either by the sender or a group moderator), the database automatically unlinks the media record if no other messages reference it. The application then permanently deletes the physical file from the storage directory.
* **Audit Logs**: Deletion audit logs do not retain sensitive metadata such as message content, file paths, filenames, or URLs.
* **Database Name**: The database name is fixed as `nexus`. Arbitrary customization of `POSTGRES_DB` is unsupported unless SQL bootstrap grants are manually updated.

## 7. Database Initialization & Migrations

* **Fresh Installation Bootstrap**: For new deployments, the database is initialized using `backend/sql/docker-init/001_schema.sh` which executes in the same psql session as `backend/sql/init.sql`.
* **Required Bootstrap Credentials**: Setting `APP_DB_USER` and `APP_DB_PASSWORD` (as well as default root credentials) is required before running the bootstrap script.
* **Init vs. Migrations**:
  - `backend/sql/init.sql` is strictly for new fresh database setups and must **never** be run against an existing production database.
  - Existing database updates are applied via migrations located in `backend/sql/migrations/`.
* **Row-Level Security (RLS) Safety**: RLS is strictly enforced on tables containing user or message data. To prevent RLS verification checks from failing for new contact links or chat associations, appropriate session-local transaction parameters (such as `app.auth_lookup`) are leveraged during validation checks.

## 8. Hardening & Privacy Policies

* **Localhost Port Binding**: By default, the production `docker-compose.yml` binds the application port (`3005`) to `127.0.0.1` (localhost) only. This prevents exposing the application's HTTP interface directly to the public internet. External access must always route through a trusted reverse proxy (such as Nginx or Caddy) that handles TLS termination.
* **TRUST_PROXY Warning**: Set `TRUST_PROXY=true` ONLY when the application container is deployed behind a trusted reverse proxy and not exposed directly. When enabled, the application trusts connection headers (like `X-Forwarded-For` and `X-Forwarded-Proto`) forwarded by the proxy.
* **Non-Root Container Execution**: The Docker container runs as a non-privileged `node` user (`USER node`). Files and directories inside `/app/storage` and `/app/logs` are owned by `node:node` to enforce security boundary isolation.
* **Node 22 Canonical Runtime**: Node 22 (`node:22-alpine`) is the canonical runtime targeted and enforced for all builds.
* **Dynamic Registration Fields**: By default, registration requires only `username`, `firstName`, and `password`. Fields `lastName`, `email`, and `phone` are optional. The Root operator can dynamically toggle any of these optional fields as "Required" from the root administration control panel, enforcing validation at the database and API levels.
* **Avatar Publicity Policy**: User and group avatars are public by design in this version. The `/avatars/...` directory route is served directly without authentication checks. Private or authenticated avatars may be added in a future release.
* **Configurable Link Preview**: The outbound link preview generation service is disabled by default (`LINK_PREVIEW_ENABLED=false`). Enabling it allows outbound HTTP/HTTPS connections from the application container. SSRF (Server-Side Request Forgery) protection is implemented using `ipaddr.js` to block loopback, private, link-local, multicast, carrier-grade NAT, and reserved IP address spaces. Redirects are capped (default 3) and re-validated for safety on every hop. Preview images are downloaded by the server, validated using magic bytes signature checks via `file-type` (rejecting SVGs, HTML files spoofed as images, and non-allowed image types), stored atomically inside `/app/storage/link-preview-cache` (owned by non-privileged `node` user), and served strictly via authenticated internal API routes (`/link-preview/image/:id`). This architecture avoids setting broad CSP `img-src https:` wildcard rules in production. The cache enforces file size caps (2 MiB), total storage caps (500 MiB), and TTL expiration (24h) with LRU eviction and periodic cleanup.
* **Privacy DTO Separation**: Public DTOs (Data Transfer Objects) for directory searches, contact lists, and group member listings omit sensitive user metadata (such as email addresses and phone numbers) to prevent public enumeration. Sensitive personal fields are only returned to the user themselves (e.g., in the `/users/me` own user endpoint).
* **Migration Transaction Policy**: Migration scripts in `backend/sql/migrations/` must never contain explicit `BEGIN`, `COMMIT`, `ROLLBACK`, or transaction management keywords at the top-level. The migration runner is responsible for wrapping each migration file execution inside its own database transaction automatically.



