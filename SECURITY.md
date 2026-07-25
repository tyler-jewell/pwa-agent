# Security

## Never commit

- `/var/lib/msa-vault/` (or any `MSA_VAULT_DIR`)
- `master.key`, `store.enc`, OAuth tokens, `~/.grok/auth.json`, `claude.env`
- Real host probe dumps that include emails or tokens

CI runs **gitleaks** (see `.github/workflows/ci.yml`). If a secret lands in git history, rotate it and treat the repo as burned for that credential.

**Org repos:** `gitleaks/gitleaks-action` may require `GITLEAKS_LICENSE` on GitHub Organizations. Personal accounts work with `GITHUB_TOKEN` alone. Prefer pinning the action by commit SHA for supply-chain hardening; migrate to `@v3` when ready.

## Threat model (short)

| Risk | Mitigation |
|------|------------|
| Public repo exfiltration | Vault outside git; age encryption; gitleaks |
| Other local users | Vault `root:msa-vault` `2770`; only `admin-agent` in group |
| Physical console | Auto-login for `admin-agent` is intentional; do not leave the Mac in public spaces |
| FileVault | **Off is a high-risk optional tradeoff** for remote cold-boot SSH (disk unencrypted at rest). Prefer On unless you explicitly accept that risk |
| Agent compromise | Non-admin user; no SecureToken; cannot rewrite `master.key` |

## Reporting

Open a private security report or issue without secrets. Do not paste tokens into GitHub issues.
