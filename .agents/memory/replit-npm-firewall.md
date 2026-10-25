---
name: Replit npm firewall
description: Handling Replit package firewall blocks caused by stale transitive npm versions
---
When dependency installation is blocked by the Replit package security policy, inspect the exact transitive package and check its current published release. A lockfile may pin an older blocked version even though the parent's semver range accepts a newer safe patch. Refresh the blocked dependency through the package-management workflow; do not bypass the firewall.

**Why:** Imported lockfiles can age past a package security block while the application manifest still permits a safe compatible release.

**How to apply:** Identify which parent requires the package, verify a compatible safe release exists, update the dependency resolution using the package-management skill, then retry installation and confirm the lockfile no longer points to the blocked release.
