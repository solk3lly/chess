# Chess Studio

Play chess against Stockfish or Maia-3, review finished games, and practice positions from your own games. Open the site to play without an account.

## Run locally

Serve this folder with Python from the repository root.

```bash
python3 -m http.server 8080 --bind 127.0.0.1
```

Open [Chess Studio](http://127.0.0.1:8080/). The UI and engine assets load from versioned CDNs. The engines run in browser workers and keep moves and evaluations on the device.

## Play, review, and practice

- In **Play**, move on the board or enter coordinates such as `e2e4`. Choose a bot profile and use the difficulty slider to see its current strength setting and search budget. You can also choose your side and bot in **Settings**. The game resumes after a reload.
- **Rookie** uses Maia-3 to sample human-like moves at Lichess style inputs of 600, 750, 900, and 1000. The first Rookie move downloads the model. **Beginner** through **Extreme** set progressively higher Stockfish Elo targets across the four difficulties. **Blitz** and **Classical** vary the default profile’s search time. **Max** gives the engine more time at each step with strength limiting off. [Calibration and sources](docs/bot-calibration.md)
- On your turn, **Claim draw** appears when the position already qualifies by threefold repetition or the 50-move rule, or when a legal move would qualify. An intended move is recorded in the claim without being played. Fivefold repetition and the 75-move rule end the match automatically. The practice opponent plays on through optional claims. [FIDE Laws of Chess, Article 9](https://handbook.fide.com/chapter/E012023)
- After checkmate, a draw, or resignation, Play opens a results dialog with your move counts. Choose **Game Review** to inspect the game with a live evaluation bar, clickable evaluation and game-phase graph, on-board move badges, best-move arrows, and a **Show threat** overlay. Switch between **Quick**, **Standard**, and **Deep** analysis presets in the review toolbar or **Settings**. Use **Analysis** for causal explanations, tactical/positional motifs, alternatives, and engine/human metrics, **Moves** to jump to any move, and **Accuracy** for head-to-head scores, phase breakdowns, and key turning points. **Past reviews** in Play opens your archive.
- Choose **Practice** in a move’s analysis to return to the board just before that move. Try a legal move, reveal a hint, or reset the board. The **Practice** page lists positions you saved.

Choose a **Board** and **Pieces** independently in Settings. The same appearance applies to Play, Game Review, and Practice, including the promotion choices. [Artwork credits and licenses](assets/THEME-CREDITS.md).

**Quick** scans the game first, then compares up to five key decisions. Open either move's line on the board and step through the reply. Use **Compare moves** to examine another choice. **Search deeper** runs one additional pass for the selected decision under node and time limits. The review can finish with provisional grades. The Accuracy tab shows how many decisions contributed to the score.

Open a saved review from **Past reviews**. **Reanalyze** runs the selected preset while keeping the saved review available. Switching games or leaving Review stops unfinished searches and keeps completed work for reopening.

Optional **Maia-3 human insights** add likely replies and estimates of which moves people will find. The model is a one-time download of about 22 MB. Analysis runs in browser workers, and game positions stay on the device.

Open **Keyboard shortcuts** from the header for keys available in Play, Review, and Practice. Press **M** to enter a move, **F** to flip the board, and **S** to open Settings. In Review, use Left and Right to replay, Home and End to jump to either end, and Escape to return to the game line. Settings can turn off the additional shortcuts. The **Board position** control lists the pieces and their squares.

Preferences use local storage. The ongoing game, completed games, reviews, and saved practice positions use IndexedDB. If another tab saves a newer match, choose **Reload saved match** to continue from that revision. The app has no review quota. Data stays in the same browser profile and site origin until the browser clears it.

## Interface components

The website uses browser-ready adaptations of the shadcn/ui New York registry. Buttons, cards, fields, and badges share the shadcn theme tokens. Dialogs, the bot popover, review tabs, sliders, progress, and the sound checkbox use Radix primitives through those components. The page uses native ES modules and an import map, so the local Python server serves it directly.

Component source and static CSS live in `ui/`. The current chess palette uses the documented semantic tokens for both themes. [shadcn/ui registry](https://ui.shadcn.com/docs/registry) · [Theming](https://ui.shadcn.com/docs/theming) · [MIT license](ui/LICENSE)

## Dependencies and third-party assets

- The browser pins Chessground to `10.1.0` and Stockfish.js to `19.0.1`. The Stockfish worker uses the Stockfish 19 Lite single-threaded JavaScript and WASM files from the same package version. The native `stockfish/` source tree is separate. [Chessground source and license](https://github.com/lichess-org/chessground), [Stockfish.js source for the pinned package](https://github.com/nmrugg/stockfish.js/tree/v19.0.1), [native Stockfish license](stockfish/Copying.txt).
- Rookie downloads an approximately 22 MB Maia-3 5M ONNX model converted from the University of Toronto CSSLab checkpoint. The model uses AGPL-3.0. The browser worker uses `maia3-js` 0.2.0 for position encoding and move sampling and ONNX Runtime Web 1.22.0 for WebAssembly inference. [Chessformer paper](https://openreview.net/forum?id=2ltBRzEHyd) · [Maia-3 source and license](https://github.com/CSSLab/maia3) · [Original checkpoint](https://huggingface.co/UofTCSSLab/Maia3-5M) · [Pinned ONNX conversion](https://huggingface.co/cstr/maia3-onnx-int32/tree/032064923ede496a0c2b7ef229c993768e891cc7) · [maia3-js package](https://registry.npmjs.org/maia3-js/0.2.0) · [ONNX Runtime Web source and license](https://github.com/microsoft/onnxruntime/tree/v1.22.0/js/web)
- To restore `vendor/chessops.bundle.js`, save the linked ESM bundle verbatim and verify SHA-256 `3d02a32866a8bba1d392eff7daa00992d5a0a3ae00f3e16ae048b80c143fefe1`. The matching source map is checked in under the filename referenced by the bundle and contains the embedded `@badrap/result` source. The published `0.3.0` and `0.3.1` versions contain identical bytes for that source file. The bundle metadata does not distinguish the two. [ESM bundle](https://esm.sh/chessops@0.15.0/es2022/chessops.bundle.mjs), [source map](vendor/chessops.bundle.mjs.map), [chessops license](https://github.com/niklasf/chessops/blob/084d2f0ccd7e9994195a8adcbba6cb974e7cac6d/LICENSE.txt), [Result license](https://github.com/badrap/result).
- The media in `assets/` entered this repo at `b8689e99957dfd71d3d04b7b777935e61b5c3f64`. The three board textures and five Futuristic sound files match the files in lila's `public/images/board/` and `public/sound/futuristic/` at `eb024cb`. The upstream notices credit the lila authors and pirouetti for the board textures, Colin M. L. Burnett for the Cburnett pieces, James Clarke and other listed contributors for the Staunton library, and Enigmahack for the Futuristic sounds. The exact upstream revisions for the imported piece image bytes are still unknown. [Lichess media notices at `eb024cb`](https://github.com/lichess-org/lila/blob/eb024cbad43714392ecce64e8d716c63cd273d00/COPYING.md), [Staunton Pieces source](https://github.com/clarkerubber/Staunton-Pieces).
- The UI and move-grade SVG sprite in `assets/icons/phosphor.svg` is curated verbatim from `@phosphor-icons/core@2.1.1` (Regular and Duotone weights, MIT License). [Phosphor Core repository and license](https://github.com/phosphor-icons/core).
- Offline ECO opening recognition in `assets/openings.json` is built from Lichess’s `chess-openings` (`a.tsv`–`e.tsv`, commit `48a8c0e733facfdc9a3723fe882e51ec28014074`, CC0 public domain), indexed by EPD across 3,865 named lines and 4,117 intermediate book positions. [Lichess chess-openings repository](https://github.com/lichess-org/chess-openings/tree/48a8c0e733facfdc9a3723fe882e51ec28014074).

## UI design skill source

The local design skill directory contains a guide and two upstream path references. For the search tool, use the `src/ui-ux-pro-max/` directory from the pinned upstream revision. Keep its `scripts/` and `data/` directories together. From that upstream checkout, run `python3 src/ui-ux-pro-max/scripts/search.py "chess web app" --design-system`. [Pinned skill scripts and data](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill/tree/e8b065f0f3aaf2e680fd125f000e4f5e351ed108/src/ui-ux-pro-max).
