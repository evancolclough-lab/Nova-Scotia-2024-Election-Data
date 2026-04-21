# Nova Scotia Poll-by-Poll Dashboard

Static HTML dashboard for exploring Nova Scotia poll-by-poll election results by constituency, poll, turnout, and party performance.

## What is included

- `index.html`: single-page dashboard shell
- `styles.css`: responsive styling for desktop and mobile
- `app.js`: filtering, chart rendering, and table population
- `data/nova-scotia-poll-results.json`: bundled dataset generated from the workbook
- `scripts/build_dataset.py`: rebuild script for future workbook updates

## Run locally

Because the app loads JSON with `fetch`, serve the folder through a local web server instead of opening `index.html` directly.

```bash
cd "/Users/evancolclough/Documents/New project/nova-scotia-poll-dashboard"
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

## Rebuild the dataset

The current script reads this workbook:

`/Users/evancolclough/Downloads/42PGE_PollbyPoll_AllEDs_TurnOut_FINAL.xlsx`

To regenerate the JSON after replacing the workbook with a newer version:

```bash
python3 "/Users/evancolclough/Documents/New project/nova-scotia-poll-dashboard/scripts/build_dataset.py"
```

## Deploy on GitHub Pages

1. Push the `nova-scotia-poll-dashboard` folder into a GitHub repository.
2. In GitHub, open `Settings` -> `Pages`.
3. Set the source to the branch you want to publish from.
4. If the dashboard lives in the repository root, publish `/root`.
5. If it lives in a subfolder, either:
   - move the dashboard files to the repository root, or
   - use a Pages workflow that publishes the `nova-scotia-poll-dashboard` directory.

Because this is a plain static site with no build step, GitHub Pages can serve it directly.
