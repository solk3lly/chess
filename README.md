# Chess Studio

Play chess against Stockfish, review finished games, and practice positions from your own games. Open the site to play without an account.

## Run locally

Serve this folder with Python from the repository root.

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

Open [Chess Studio](http://127.0.0.1:8080/). The UI runtime, board library, and Stockfish assets load from versioned CDNs. The app runs the engine in a browser worker and keeps moves and evaluations on the device.

## Play, review, and practice

- In **Play**, move on the board or enter coordinates such as `e2e4`. Choose a bot profile and adjust its search effort with the difficulty slider. You can also choose your side and bot in **Settings**. The game resumes after a reload.
- **Rookie · 250 Elo target** sometimes chooses a weaker legal move for beginner practice. The number is a practice target pending calibration. The other named presets use Stockfish's built-in Elo setting, and their strength varies with search effort.
- After checkmate, a draw, or resignation, Play opens a results dialog with your move counts. Choose **Game Review** to replay while Stockfish evaluates positions. Use **Analysis** for the selected move and its alternatives, **Moves** to jump to any move, and **Accuracy** to see the game summary. **Past reviews** in Play opens your archive.
- Choose **Practice** in a move’s analysis to return to the board just before that move. Try a legal move, reveal a hint, or reset the board. The **Practice** page lists positions you saved.

The move accuracy estimate measures how much the evaluation dropped from Stockfish's preferred move, using the mover's perspective. **Your game accuracy** averages the player's move percentages. The review flags a lost advantage when the preferred line scores at least 60% on the app's winning-chance scale and the played move falls to 55% or lower. Explanations describe features visible on the board and use short Stockfish lines to show what could follow.

Chess Studio calls a move **Brilliant** when Stockfish prefers it by a clear margin, the line keeps an advantage, and its reply and follow-up show an accepted sacrifice worth at least a minor piece.

Preferences use local storage. The ongoing game, completed games, reviews, and saved practice positions use IndexedDB. The app has no review quota. Data stays in the same browser profile and site origin until the browser clears it.

## Interface components

The website uses browser-ready adaptations of the shadcn/ui New York registry. Buttons, cards, fields, and badges share the shadcn theme tokens. Dialogs, the bot popover, review tabs, sliders, progress, and the sound checkbox use Radix primitives through those components. The page uses native ES modules and an import map, so the local Python server serves it directly.

Component source and static CSS live in `ui/`. The current chess palette uses the documented semantic tokens for both themes. [shadcn/ui registry](https://ui.shadcn.com/docs/registry) · [Theming](https://ui.shadcn.com/docs/theming) · [MIT license](ui/LICENSE)

## Dependencies and third-party assets

- The browser pins Chessground to `10.1.0` and Stockfish.js to `19.0.1`. The Stockfish worker uses the Stockfish 19 Lite single-threaded JavaScript and WASM files from the same package version. The native `stockfish/` source tree is separate. [Chessground source and license](https://github.com/lichess-org/chessground), [Stockfish.js source for the pinned package](https://github.com/nmrugg/stockfish.js/tree/v19.0.1), [native Stockfish license](stockfish/Copying.txt).
- To restore `vendor/chessops.bundle.js`, save the linked ESM bundle verbatim and verify SHA-256 `3d02a32866a8bba1d392eff7daa00992d5a0a3ae00f3e16ae048b80c143fefe1`. The matching source map is checked in under the filename referenced by the bundle and contains the embedded `@badrap/result` source. The published `0.3.0` and `0.3.1` versions contain identical bytes for that source file. The bundle metadata does not distinguish the two. [ESM bundle](https://esm.sh/chessops@0.15.0/es2022/chessops.bundle.mjs), [source map](vendor/chessops.bundle.mjs.map), [chessops license](https://github.com/niklasf/chessops/blob/084d2f0ccd7e9994195a8adcbba6cb974e7cac6d/LICENSE.txt), [Result license](https://github.com/badrap/result).
- The media in `assets/` entered this repo at `b8689e99957dfd71d3d04b7b777935e61b5c3f64`. The three board textures and five Futuristic sound files match the files in lila's `public/images/board/` and `public/sound/futuristic/` at `eb024cb`. The upstream notices credit the lila authors and pirouetti for the board textures, Colin M. L. Burnett for the Cburnett pieces, James Clarke and other listed contributors for the Staunton library, and Enigmahack for the Futuristic sounds. The exact upstream revisions for the imported piece image bytes are still unknown. [Lichess media notices at `eb024cb`](https://github.com/lichess-org/lila/blob/eb024cbad43714392ecce64e8d716c63cd273d00/COPYING.md), [Staunton Pieces source](https://github.com/clarkerubber/Staunton-Pieces).
- The UI and move-grade SVG sprite in `assets/icons/phosphor.svg` is curated verbatim from `@phosphor-icons/core@2.1.1` (Regular and Duotone weights, MIT License). [Phosphor Core repository and license](https://github.com/phosphor-icons/core).

## UI design skill source

The local design skill directory contains a guide and two upstream path references. For the search tool, use the `src/ui-ux-pro-max/` directory from the pinned upstream revision. Keep its `scripts/` and `data/` directories together. From that upstream checkout, run `python3 src/ui-ux-pro-max/scripts/search.py "chess web app" --design-system`. [Pinned skill scripts and data](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/tree/e8b065f0f3aaf2e680fd125f000e4f5e351ed108/src/ui-ux-pro-max).
