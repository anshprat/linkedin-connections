# LinkedIn Connections Exporter

A Chrome extension that auto-scrolls your LinkedIn connections page, extracts contact data, and exports it to CSV.

## What it captures

- **Name** — Full name of the connection
- **LinkedIn Profile URL** — Direct link to their profile
- **Headline** — Job title / professional headline
- **Connected On** — When you connected (relative time as shown on the page)
- **Profile Image URL** — Link to their profile photo
- **Scraped At** — Timestamp when the data was captured

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top right)
3. Click **Load unpacked**
4. Select this folder (`linkedin-get-self-connections`)
5. The extension icon will appear in your toolbar

## Usage

1. Navigate to your [LinkedIn Connections page](https://www.linkedin.com/mynetwork/invite-connect/connections/)
2. Click the extension icon in the toolbar
3. Adjust the **scroll delay** if needed (higher = safer, lower = faster)
4. Click **Start Scraping**
5. The extension will auto-scroll the page and collect connection data
6. It stops automatically when no new connections are found
7. Click **Export CSV** to download your data

## Settings

- **Scroll delay (ms)**: Time between each scroll action. Higher values (2000-3000ms) are safer for avoiding LinkedIn rate limiting. Default is 1500ms.

## Notes

- Data is stored locally in your browser using `chrome.storage.local`
- Connections are deduplicated by profile URL
- You can close the popup while scraping — it continues in the background
- Click **Clear Data** to reset and start fresh
- The "Connected On" date is captured as the relative text shown on the page (e.g., "Connected 2 weeks ago")

## Existing alternatives considered

| Tool | Free? | Connected Date? | Notes |
|------|-------|----------------|-------|
| LinkedIn Native Export (Settings > Data Privacy) | Yes | Yes (exact) | Takes hours, no headline |
| LinkedIn Connections Exporter (Chrome Web Store) | Yes | No | Missing connected date |
| PhantomBuster | $56+/mo | Claims yes | Expensive |
| Open-source GitHub scrapers | Yes | No | Mostly broken/outdated |

This extension fills the gap: free, open-source, captures all visible data including connection dates.

## Disclaimer

This tool is for personal use to export your own connection data. Use responsibly and in accordance with LinkedIn's Terms of Service. Excessive or aggressive scraping may result in account restrictions.
