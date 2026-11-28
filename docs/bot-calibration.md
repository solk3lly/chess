# Bot calibration

Chess Studio runs the single-threaded Stockfish 19 Lite WebAssembly engine from Stockfish.js 19.0.1. The Lite build uses a smaller neural network and runs on a static site without cross-origin isolation. This is the engine the app needs to evaluate for playing strength. The native source tree in this repository does not run in the browser. [Pinned Stockfish.js build](https://github.com/nmrugg/stockfish.js/tree/v19.0.1#the-engines)

## Stockfish targets and search budgets

Stockfish accepts `UCI_Elo` targets from 1320 through 3190 when `UCI_LimitStrength` is enabled. The upstream calibration used a two-minute clock with a one-second increment and referenced CCRL Blitz results through a set of Stash engine versions. The original fit reports that the anchor values varied by about 100 Elo with the opponent pool. Chess Studio uses a different engine build and a per-move budget, so the numbers in the picker are UCI targets. FIDE and online ratings belong to their own player pools. [Stockfish UCI options](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-Protocol-and-Stockfish-Commands.html#uci_elo) · [Original calibration results](https://github.com/vondele/Stockfish/commit/a08b8d4e9711c2) · [Lichess on rating pools](https://lichess.org/page/rating-systems)

Stockfish maps each target to an internal skill level. It searches at least four root candidates when enough moves are legal and uses a randomized bias to pick a move at a depth set by that skill level. When the time budget expires earlier, the engine can pick from the search it has completed. This makes very short searches a poor substitute for distinct targets. The app assigns more time to higher-rated profiles because their intended selection depth is greater. These budgets are app settings chosen to balance search depth and response time. The budget is approximate, and the attained depth varies by position and device. [Stockfish skill selection](https://official-stockfish.github.io/docs/stockfish-wiki/Stockfish-FAQ.html#how-do-skill-level-and-uci-elo-work) · [Stockfish 19 search source](https://github.com/official-stockfish/Stockfish/blob/sf_19/src/search.cpp) · [UCI move time](https://official-stockfish.github.io/docs/stockfish-wiki/UCI-Protocol-and-Stockfish-Commands.html#movetime-x)

| Rated profile | Relaxed | Standard | Strong | Maximum | Search budget per move |
| --- | ---: | ---: | ---: | ---: | ---: |
| Beginner | 1320 | 1400 | 1450 | 1500 | 0.4 s |
| Casual | 1380 | 1450 | 1550 | 1650 | 0.4 s |
| Intermediate | 1500 | 1600 | 1700 | 1800 | 0.4 s |
| Club | 1650 | 1750 | 1850 | 1950 | 0.4 s |
| Advanced | 1800 | 1900 | 2000 | 2100 | 0.4 s |
| Competitive | 1950 | 2050 | 2150 | 2250 | 0.5 s |
| Expert | 2100 | 2200 | 2300 | 2400 | 0.75 s |
| Elite | 2400 | 2500 | 2600 | 2700 | 1.2 s |
| Champion | 2700 | 2800 | 2900 | 3000 | 2 s |
| Extreme | 3000 | 3100 | 3150 | 3190 | 2.8 s |

The Standard column keeps the previous targets from Casual through Extreme. Beginner starts at the engine floor on Relaxed and uses 1400 on Standard so all four settings have distinct targets. Adjacent profiles can overlap across difficulty steps. At the same step, each named rated profile has a higher target than the previous one.

Default, Blitz, and Classical share targets of 1320, 1450, and 2050 on the first three steps. Their Maximum step disables strength limiting. Shorter and longer searches can produce similar play when both reach Stockfish's intended selection depth. Max disables strength limiting at every step and changes the amount of time available for calculation.

| Profile | Relaxed | Standard | Strong | Maximum |
| --- | ---: | ---: | ---: | ---: |
| Default | 0.2 s | 0.4 s | 0.8 s | 1.6 s |
| Blitz | 0.1 s | 0.2 s | 0.4 s | 0.8 s |
| Classical | 0.3 s | 0.6 s | 1.2 s | 2.4 s |
| Max | 0.4 s | 0.8 s | 1.6 s | 3.2 s |

## Rookie

Rookie uses the Maia-3 5M model to sample a legal move from its predicted distribution. Maia predicts the moves people play at a given rating. The worker gives the model the current position and up to seven prior positions. Since Chess Studio has no player rating, both sides receive the selected style input. Rookie still takes an available mate in one before consulting Maia. [Maia-3 paper](https://openreview.net/forum?id=2ltBRzEHyd) · [Maia-3 UCI inputs](https://github.com/CSSLab/maia3#uci-options)

| Rookie setting | Lichess style input |
| --- | ---: |
| Relaxed | 600 |
| Standard | 750 |
| Strong | 900 |
| Maximum | 1000 |

600 is the lower end of Maia's published rating range. The slider describes a move style learned from human games. Rookie's match strength remains unmeasured in Chess Studio. [Maia Chess](https://www.maiachess.com/)

The browser downloads the pinned ONNX conversion when Rookie first needs a move and reuses the cached file when browser storage is available. The ONNX export uses 32-bit integer rating inputs and preserves all eight history positions. Inference runs in a worker with one WebAssembly thread. Stockfish evaluates finished games and practice positions as before. [Pinned ONNX export](https://huggingface.co/cstr/maia3-onnx-int32/tree/032064923ede496a0c2b7ef229c993768e891cc7) · [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/)

## What a measured rating would require

A relative rating study would use the exact browser engine and move-selection rules, representative devices, and a fixed set of reference opponents spanning the strength range. Each opening would be played with colors reversed. Opening pairs would be the unit of analysis, with uncertainty intervals reported for estimated rating differences. A separate set of openings would check any parameters tuned on the first set. A human-facing rating would additionally need results anchored to a named human pool and time control. [Stockfish paired game setup](https://official-stockfish.github.io/docs/fishtest-wiki/Running-Fastchess.html) · [Fishtest match statistics](https://official-stockfish.github.io/docs/fishtest-wiki/Fishtest-Mathematics.html)

Match-based ratings for Chess Studio remain unmeasured.
