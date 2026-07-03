# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 1.0.x | Yes |

## Reporting a Vulnerability

Please use GitHub private vulnerability reporting if it is enabled for this repository.

Security contact: TODO: add security contact

Do not publish exploit details, secrets, tokens, private messages, database dumps, or server-specific deployment information in public issues or pull requests.

## Security Expectations

- Do not commit `.env` files or secrets.
- Use HTTPS in production through a trusted reverse proxy.
- Set strong `JWT_SECRET`, `JWT_REFRESH_SECRET`, database passwords, and root/admin credentials.
- Keep dependencies and container base images updated.
- Back up PostgreSQL data, Redis data if needed, and uploaded storage.
- Review exposed ports before internet-facing deployment.
- Keep uploads and storage private as appropriate for your deployment.
- Keep `RESET_ROOT_PASSWORD_ON_BOOT=false` in production.

