[Play Evolution Simulator](https://stiwarilbj.github.io/Shantanu_Tiwari/experiments/evolution-simulator/)

# Evolution Simulator

Watch blobs look for food, hunt, and have babies. Small changes in speed, size, and sight can affect which blobs survive.

## Try it

- **World** plays one day at a time. Pick a blob to follow it, or use **Quick Sim** to jump ahead. If the last blob dies, select the extinction tile to watch the ending.
- **Settings** lets you make species, change their traits, and decide how much food to put out. Open **Advanced** to grow food in patches, widen the refuge, or set when hunting begins and how much bigger a hunter has to be. Use **Preview day** to see where the plants will appear.
- **Starting territories** lets you choose which edges each species starts on and how close together the blobs begin. Preview their spots at dawn, then try it for one generation or every day.
- **Inheritance and reproduction** lets you try two-parent families, set the odds of twins, and decide how often each species’ traits change. Open Creature Details during a replay to see who the parents were.
- **Trends** shows how the population changes over time. Choose **Walk through age**, then pick a day to see the ages behind the average. **Compare** lets you look at two runs side by side.
- **Graph predictions** extend the charts with a dashed estimate based on recent generations in view. Open **Settings → Advanced → Graph predictions** to hide the estimates or change how many generations they cover.
- **About** lets you try a stride race or follow a newborn as it searches for food. Run the 600-generation experiment to see how changing size mutation affects the whole group, then replay hunts from each run.

The simulator follows the [standalone build at `3a3d385`](https://github.com/stiwarilbj/Evolution_Simulator/tree/3a3d38572d2912e6262189ee2fffaf657d3a256e). See its [UI guide](https://github.com/stiwarilbj/Evolution_Simulator/blob/3a3d38572d2912e6262189ee2fffaf657d3a256e/outputs/evolution-simulator-implemented-ui.md) for the current design.

## Run it locally

Use Node.js 22.12 or newer.

```sh
npm ci
npm run dev
```

Run `npm test` for the simulation checks and `npm run build` for a standalone build. To run the browser suite, install Chromium with `npx playwright install chromium` and run `npm run test:browser` after building.

From this folder, run `npm run build:pages` to refresh the published files in `docs/experiments/evolution-simulator` at the repo root. Commit the source changes and the refreshed build together.
