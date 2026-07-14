# Netlify Deploy Recovery

## Problem

Netlify fails during `preparing repo` before the app build starts:

```text
git clone --filter=blob:none https://github.com/soleman23/golo
Host key verification failed.
fatal: Could not read from remote repository.
```

The local repo remote is `https://github.com/soleman23/golo.git`, the active branch is `main`, and a remote branch check confirmed GitHub can see `main`.

## Likely Cause

This is probably not caused by app code or `netlify.toml`, because Netlify fails before it clones the repo. The odd part is that Netlify logs an HTTPS clone but reports an SSH-only error, which suggests stale Netlify GitHub connection state, account/team-level Git environment overrides, or a Netlify-side clone issue.

## Checks

1. In Netlify, check project environment variables:
   `Project configuration > Environment variables`

2. Check team/shared environment variables:
   `Team settings > Environment variables`

3. Remove any unexpected Git/SSH-related variables, especially:
   - `GIT_SSH`
   - `GIT_SSH_COMMAND`
   - `GIT_SSH_VARIANT`
   - `GIT_CONFIG_*`
   - unknown variables starting with `GIT_`

4. Confirm the Netlify GitHub App has access to:
   `soleman23/golo`

   GitHub settings:
   `Settings > Applications > Installed GitHub Apps > Netlify`

## Recovery Steps

1. In Netlify, relink the repository:
   `Project configuration > Build & deploy > Continuous deployment > Repository`

2. Select:
   `Manage repository > Link to a different repository`

3. Re-select the same repository:
   `soleman23/golo`

4. Use branch:
   `main`

5. Trigger a fresh deploy without cache.

## Isolation Test

If the old site still fails, create a brand-new Netlify test site from the same repo:

- Repository: `soleman23/golo`
- Branch: `main`
- Build command: `npm run build`
- Publish directory: `dist`

If the new site deploys, the old Netlify site has stale or broken linked-repository state. Move the domain and environment variables to the new site, or ask Netlify Support to purge/recreate the old site's linked Git credentials.

## Support Note

Send this to Netlify Support if both the original and test site fail:

```text
Netlify logs:
git clone --filter=blob:none https://github.com/soleman23/golo

But it fails with:
Host key verification failed

That is SSH-only behavior even though the logged clone URL is HTTPS.
The repo exists, branch main exists, and git ls-remote returned:
19a8a27987224664784574014562c0817cf56f97 refs/heads/main
```

## Temporary Workaround

To deploy while Netlify Git cloning is broken, build locally and upload `dist` manually through Netlify's deploy UI or CLI.
