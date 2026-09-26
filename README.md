# Roblox Mass Unblock

A Tampermonkey/Greasemonkey userscript that lets you **browse, search, select, and mass-unblock** users from your Roblox blocked list — with live progress, retry support, and optional JSON backups.

---

## How to Use

1. Click the **Mass Unblock** button (bottom-right).
2. Click **Load / Refresh** to fetch your blocked list.
3. (Optional) Use the search box to filter by name or ID.
4. Select the users you want to unblock (or use Select all / none / invert).
5. (Strongly recommended) Click **Export backup** to download a JSON file of everyone currently blocked.
6. Adjust the **Delay (ms)** if needed (default 300 ms is usually fine).
7. Click **Unblock selected**.
8. Confirm the dialog.
9. Watch the progress bar and activity log.
10. If some fail, click **Retry failed**.

You can stop a running job with the **Stop** button.

---

## Installation

1. Install Tampermonkey (or another userscript manager).
2. Create a new script.
3. Paste the entire contents of the script.
4. Save.
5. Go to any page on `https://www.roblox.com/*`.

A red **“Mass Unblock”** button will appear in the bottom-right corner.

---

## Requirements

- A userscript manager:
  - [Tampermonkey](https://www.tampermonkey.net/) (recommended)
  - Violentmonkey or Greasemonkey also work
- You must be logged into Roblox in the same browser

---

## Features

- **Load your full blocked list** (paginated, handles large lists)
- **Search** by username or user ID
- **Select all / none / invert** (works on the currently filtered view)
- **Configurable delay** between unblock requests (helps avoid rate limits)
- **Live progress bar + status** and detailed activity log
- **Retry failed** users with one click
- **Export backup** of the blocked list as JSON before you start
- **Draggable panel** + Escape to close
- Automatic CSRF token handling and retries on 403 / 429 / network errors

---

## Controls Overview

| Button / Control       | Action |
|------------------------|--------|
| **Load / Refresh**     | Fetch the current blocked list |
| **Search**             | Filter by name or ID (live) |
| **Select all**         | Select all visible (non-unblocked) users |
| **Select none**        | Deselect all visible users |
| **Invert**             | Invert selection on visible users |
| **Export backup**      | Download JSON of the loaded list |
| **Delay (ms)**         | Pause between each unblock request |
| **Unblock selected**   | Start the mass unblock |
| **Stop**               | Cancel the current run |
| **Retry failed**       | Re-attempt only the users that failed |

---

## Technical Notes

- Uses the official Roblox User Blocking API (`/user-blocking-api/v1/...`).
- Automatically obtains and refreshes the `x-csrf-token`.
- Retries up to 5 times per user with exponential backoff + jitter on 429 / network errors.
- Resolves display names in batches of 100 when they are missing from the blocked-users response.
- Guard against double-injection on SPA navigations.

---

## Disclaimer

This script is provided for **personal convenience**.  
Unblocking users is permanent (from the script’s perspective).  
Always export a backup first.  
Use responsibly and at your own risk. Roblox’s terms of service apply.
