# Place Naming Game

The page includes the country list. The game downloads `places/world.json` for worldwide play or a file from `places/countries/` for a specific country.

Choose **Untimed practice** under **Time Limit** to play with the same filters and scoring at your own pace. Select **Finish Practice** to review your guesses. Preferences lists practice scores and timed scores separately.

In Preferences, name your settings and select **Save current setup** to keep up to five favorites. Select a saved name to fill in the country or mode, letters, time limit, and spelling rule before you start. To update a favorite, save again under the same name.

The game stores preferences, timed scores, practice scores, and a saved round in this browser. In Preferences, **Keep counting** runs the clock in the background, **Pause when I switch away** pauses the current tab, and **Pause and save my round** lets you pick up after refreshing. Select **Resume Game** to continue a paused round. **Reset Game** discards the current attempt, and **Clear saved data** deletes this game's saved data.

Choose Standard for the usual one-typo allowance or Strict for exact spelling, with any capitalization. Relaxed also accepts missing accents and familiar country names like USA, UK, UAE, Czechia, and Türkiye. Exact answers come first, and if a looser match could mean several places, the game asks for the exact spelling or country.

After editing `PlacesData.js`, run these commands from this folder to update the list and dictionaries. Commit the generated changes with the source edit.

```sh
node generate-place-dictionary.mjs
node generate-place-dictionary.mjs --check
```
