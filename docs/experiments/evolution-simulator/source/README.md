[Play Evolution Simulator](https://stiwarilbj.github.io/Shantanu_Tiwari/experiments/evolution-simulator/)

[Controls and settings reference](https://stiwarilbj.github.io/Shantanu_Tiwari/experiments/evolution-simulator/reference.html)

# Evolution Simulator

Watch blobs look for food, hunt, and have babies as small changes in speed, size, and sight affect which ones survive. Quick Sim runs 10 generations by default, remembers a count you change, and reports population, births, deaths, and meals at the end. Use the generation table or Trends to follow development over time.

## Try it

- **World** shows the simulation as it happens. Use the **1×** button to watch live days and replays up to eight times faster, or use **Quick Sim** to jump ahead. Pick a blob to follow it, or select the extinction tile to watch the ending.
- **Adjust living traits** pauses the day so you can change speed, size, or sense range for a group you choose. Under **Playback actions → Adjust living traits**, pick one or more species, search for individual blobs, or narrow the group to blobs in the field or in refuge. Check the preview before applying, then use **Creature Details** in replay to see when the change happened.
- In **Settings → Basic → Blob Creatures**, choose **New species** or **Duplicate**. Pick a starting preset or open **Customize traits**, then choose **Add to setup**.
- Use **World → Species → Add to field** to release a new species during a paused day. You can also split a living group or edit a species from the same window. Replays show when blobs arrived or changed, and JSON exports carry that history with the run.
- **Advanced settings** has controls for the whole experiment. Open **Advanced** to browse **Field & food**, **Creature behavior**, **Life cycle**, and **Run & charts**. Use **Plant supply** to change how many plants grow and **Field layout** to change where they grow. Both show a preview of the day you pick.
- **Food seasons** lets you set how far plant supply falls and how long it takes to recover. Preview a full cycle under **Advanced → Field & food**, then compare the dawn plant counts with the base schedule in **Trends → Food**.
- Under **Advanced → Field & food → Food types**, split the plant supply into seeds, berries, and mushrooms. Set how much of each grows and choose which ones each species can eat. Turn it off to return to one food type and keep the mix you set.
- **Species food web** gives each species its own diet. Test an encounter under **Advanced → Creature behavior**, or pause a run and change diets under **World → Species**. Open **Advanced Stats → Food & Hunting** to see what each species actually ate.
- **Starting territories** lets you choose which edges each species starts on and how close together the blobs begin. Preview their spots at dawn, then try it for one generation or every day.
- **Optional rules** let you turn off reproduction, meal energy refills, or custom foraging and keep the values you set. A blob can still survive and collect food when reproduction and refills are off.
- **Reproduction** lets you try two-parent families and set the odds of twins. In **Inheritance & mutation**, you decide how often each species’ traits change. Open Creature Details during a replay to see who the parents were.
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

The source lives in `docs/experiments/evolution-simulator/source`. Run `npm run build:pages` here to refresh the published files in the parent folder. Commit the source changes and the refreshed build together.
