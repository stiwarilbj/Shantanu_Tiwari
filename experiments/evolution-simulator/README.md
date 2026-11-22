[Play Evolution Simulator](https://stiwarilbj.github.io/Shantanu_Tiwari/experiments/evolution-simulator/)

# Evolution Simulator

Watch blobs look for food, hunt, and have babies. Small changes in speed, size, and sight can affect which blobs survive.

## Try it

- **World** plays one day at a time. Pick a blob to follow it, or use **Quick Sim** to jump ahead. If the last blob dies, select the extinction tile to watch the ending.
- **Settings** lets you make species, change their traits, and decide how much food to put out.
- **Trends** shows how the population changes over time. Choose **Walk through age**, then pick a day to see the ages behind the average. **Compare** lets you look at two runs side by side.
- **About** includes a guided walkthrough and a 600-generation experiment you can run and replay.

## Run it locally

Use Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

Run `npm test` for the simulation checks and `npm run build` for a standalone build. To run the browser suite, install Chromium with `npx playwright install chromium` and run `npm run test:browser` after building.

From this folder, run `npm run build:pages` to refresh the published files in `docs/experiments/evolution-simulator` at the repo root. Commit the source changes and the refreshed build together.
