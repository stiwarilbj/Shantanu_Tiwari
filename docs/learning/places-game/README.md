# Place Naming Game

Choose a country and letters. The game checks your filters right away and asks you to change them if no places match. Select **Load places**, then **Start Game** when the dictionary is ready. Search, examples, and clues also load places when needed.

Choose **Untimed practice** under **Time Limit** to play with the same filters and scoring at your own pace. Select **Finish Practice** to review your guesses. Preferences lists practice scores and timed scores separately.

After a timed round or practice session, open **Round review** to see which guesses scored as typed, which needed a spelling correction, and which were already counted. If the game recognizes a place ruled out by your country or letter filters, it explains why. Choose **Retry same setup** to start a fresh round with the same rules.

Choose **Today’s challenge** in Preferences to load the day’s rules, then select **Start Game** when ready. Everyone using the same dictionary version gets the same challenge for that UTC date, with at least 60 distinct answers and hints locked until the round ends. Finished attempts show the challenge date in your local scorebook.

Open **Scorebook** in Preferences to see your best scores and five recent attempts for each challenge. A challenge uses the same timer, country or answer mode, letter filters, and spelling rules. Rounds where you revealed a clue, examples, or Search results have a separate best score. Older rounds without a hint record still appear with **Hint use unknown**. Beat a known best and **Round review** shows the improvement.

In Preferences, choose **Examples** to see place names, **Clues only** to get the country and letter count of an unguessed answer, or **After the round** to open Search and examples once you finish. Spaces and punctuation don't count toward a clue's letter count. Choose your hint mode before starting a round.

In Preferences, name your settings and select **Save current setup** to keep up to five favorites. Select a saved name to fill in the country or mode, letters, time limit, spelling, and hints before you start. To update a favorite, save again under the same name.

In **Preferences → Saved setups**, choose **Copy setup link** for your current setup or one of your favorites. The link fills in the country or answer mode, letters, time limit, spelling, and hints. The timer starts when your friend selects **Start Game**. If an option has changed, the game points out what to choose again.

Under **Sound** in Preferences, choose **Off**, **Time up only**, or **Correct answers and time up**. Sound starts off and your choice is saved in this browser.

The game stores preferences, timed scores, practice scores, and a saved round in this browser. In Preferences, **Keep counting** runs the clock in the background, **Pause when I switch away** pauses the current tab, and **Pause and save my round** lets you pick up after refreshing. Select **Resume Game** to continue a paused round. **Reset Game** discards the current attempt, and **Clear saved data** deletes this game's saved data.

Choose **Standard** for the usual one-typo allowance or **Strict** for exact spelling, with any capitalization. **Accent-friendly** fills in missing accents when one answer fits. Type `Sao Luis, Brazil` to see **Counted as São Luís, Brazil**.

**Relaxed** also shows the correct name when it fills in accents. It accepts typos and familiar country names like USA, UK, UAE, Czechia, and Türkiye. Exact answers come first, and if several places match, the game asks for the exact spelling or country.

After editing `PlacesData.js`, run these commands from this folder to update the list and dictionaries. Commit the generated changes with the source edit.

```sh
node generate-place-dictionary.mjs
node generate-place-dictionary.mjs --check
```
