# EdgeRedirector

A Firefox extension that automatically opens configured URLs in Microsoft Edge.

## Usage

1. Click the extension icon and go to **Settings** (or `about:addons` → Edge Redirector → Preferences)
2. Add domains (one per line) that should open in Edge
3. Choose how to handle matched links:

| Setting | Behavior |
|---------|----------|
| **Open only in Edge** | Cancels Firefox navigation, opens the link in Edge |
| **Open in both browsers** | Opens the link in Edge alongside Firefox |

4. Optionally toggle **confirmation mode** to see a prompt before redirecting

## Changelog

### v1.22

- **Fixed**: "Open only in Edge (cancel Firefox)" now reliably prevents Firefox tabs—race condition eliminated between `webNavigation` and `webRequest` listeners via synchronous settings cache
- **Fixed**: Two Edge tabs (one blank) no longer open—replaced `tabs.create` with off-screen `windows.create` popup to fire the protocol handler exactly once
- **Fixed**: "Stay in Firefox" on the confirm page no longer re-triggers the redirect loop—URLs now carry a bypass hash to suppress re-interception
- **Internal**: Extension settings cached synchronously at startup and kept in sync via `storage.onChanged` for instant blocking decisions

### v1.21

- **New**: Configurable open mode — choose "Edge only" (cancel Firefox) or "Both browsers"
- **Fixed**: Tab no longer left behind as a blank page (uses transient background tab for Edge protocol)
- **Fixed**: `edgeOnly` mode now correctly cancels Firefox navigation (was silently broken in dual-listener architecture)
- **Fixed**: Confirm page tab can no longer be confused with another tab that happens to be active
- **Improved**: Confirmation dialog shows contextual text based on the selected open mode
- **Internal**: Added fallback for Edge protocol launch when background communication fails

### v1.20

- Initial release