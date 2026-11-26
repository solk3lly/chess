import { createElement as h, Fragment } from 'react';
import {
  Alert, AlertDescription, Badge, Button, ButtonGroup, Card, CardContent, CardDescription,
  CardHeader, CardTitle, Icon, Input, Label, NativeSelect, TabsContent, TabsList, TabsTrigger,
} from './ui/shadcn.js';
import { renderUI } from './ui/render.js';
import { DifficultyPicker, ReviewTabs } from './studio-widgets.js';
import { BOT_PROFILES, DIFFICULTY_ORDER, LEVELS } from './studio-game.js';

function SiteHeader() {
  return h("header", { className: "site-header" },
    h("div", { className: "site-header-inner" },
      h(Button, { id: "home", className: "wordmark", type: "button", "aria-label": "Chess Studio home", variant: "ghost" },
        h("span", { className: "brand-piece", "aria-hidden": "true" },
          h(Icon, { name: "horse-duotone", className: "icon brand-icon" })
        ),
        h("span", null, "Chess Studio")
      ),
      h("nav", { "aria-label": "Chess Studio" },
        h(Button, { type: "button", "data-mode": "play", "aria-current": "page", variant: "ghost", size: "sm" },
          h(Icon, { name: "strategy" }),
          h("span", null, "Play")
        ),
        h(Button, { type: "button", "data-mode": "practice", variant: "ghost", size: "sm" },
          h(Icon, { name: "target" }),
          h("span", null, "Practice")
        )
      ),
      h(Button, { type: "button", id: "settings-open", className: "settings-button", variant: "outline" },
        h(Icon, { name: "gear-six" }),
        h("span", null, "Settings")
      )
    )
  );
}

function BoardArea() {
  return h("section", { className: "board-area", "aria-label": "Chessboard" },
    h("div", { className: "board-status" },
      h("span", { className: "turn-dot", id: "turn-dot", "data-color": "white", "aria-hidden": "true" }),
      h("span", { id: "board-status", role: "status" }, "Loading board…"),
      h(Button, { type: "button", className: "return-button", id: "return-to-game", hidden: true, variant: "outline", "aria-label": "Return to game" },
        h(Icon, { name: "arrow-u-up-left" }),
        h("span", null, "Return to game")
      ),
      h(Button, { type: "button", className: "icon-button", id: "flip-board", "aria-label": "Flip board", variant: "ghost", size: "icon" },
        h(Icon, { name: "arrows-down-up" })
      )
    ),
    h("div", { id: "chessground", className: "cg-wrap board-shell", "data-board-style": "brown", "data-piece-style": "2d" }),
    h(ButtonGroup, { id: "replay-controls", className: "replay-controls", hidden: true },
      h(Button, { type: "button", className: "icon-button", id: "replay-start", "aria-label": "Starting position", variant: "outline", size: "icon" },
        h(Icon, { name: "caret-line-left" })
      ),
      h(Button, { type: "button", className: "icon-button", id: "replay-back", "aria-label": "Previous position", variant: "outline", size: "icon" },
        h(Icon, { name: "caret-left" })
      ),
      h("div", { id: "replay-slider" }),
      h(Button, { type: "button", className: "icon-button", id: "replay-next", "aria-label": "Next position", variant: "outline", size: "icon" },
        h(Icon, { name: "caret-right" })
      ),
      h(Button, { type: "button", className: "icon-button", id: "replay-end", "aria-label": "Final position", variant: "outline", size: "icon" },
        h(Icon, { name: "caret-line-right" })
      )
    ),
    h("form", { id: "move-form", className: "move-form" },
      h(Label, { htmlFor: "move-input" }, "Enter a move"),
      h(ButtonGroup, { className: "input-row" },
        h(Input, { id: "move-input", type: "text", placeholder: "e2e4", maxLength: 5, autoComplete: "off", autoCapitalize: "off", spellCheck: false, "aria-describedby": "move-error" }),
        h(Button, { type: "submit", id: "move-submit", variant: "outline" },
          h("span", null, "Move"),
          h(Icon, { name: "arrow-right" })
        )
      ),
      h("p", { id: "move-error", className: "input-error", role: "status", hidden: true })
    )
  );
}

function PlayPanel() {
  return h(Card, { id: "play-panel", className: "panel", "aria-labelledby": "play-title" },
    h(CardHeader, { className: "panel-header" },
      h(CardTitle, { id: "play-title" }, "Play the bot"),
      h("div", { className: "play-header-meta" },
        h("p", { id: "match-description" }, "You play White"),
        h(DifficultyPicker, { className: "difficulty-picker", id: "difficulty-picker" },
          h(Button, { type: "button", id: "difficulty-trigger", className: "difficulty-trigger", title: "Change bot and difficulty", variant: "outline" },
            h("span", { id: "difficulty-trigger-bot", className: "difficulty-trigger-bot" }, BOT_PROFILES.default.label),
            h("span", { id: "difficulty-trigger-level", className: "difficulty-trigger-level" }, "Standard"),
            h(Icon, { name: "caret-left", className: "icon difficulty-trigger-caret" })
          ),
          h("div", { id: "difficulty-slider-view", className: "difficulty-view" },
            h("div", { className: "difficulty-card-head" },
              h("div", { className: "difficulty-card-title" },
                h("span", { className: "difficulty-caption" }, "Bot difficulty"),
                h("strong", { id: "difficulty-active-label", className: "difficulty-active-label" }, "Standard"),
                h("span", { id: "difficulty-time", className: "difficulty-caption" })
              ),
              h(Button, { type: "button", id: "difficulty-reset", className: "icon-button difficulty-reset", "aria-label": "Reset bot and difficulty to default", title: "Reset bot and difficulty", variant: "ghost", size: "icon" },
                h(Icon, { name: "arrow-clockwise" })
              )
            ),
            h("div", { className: "difficulty-scale" },
              h("div", { id: "difficulty-slider-shell" }),
              h("div", { className: "stepped-slider-labels", "aria-hidden": "true" },
                DIFFICULTY_ORDER.map((key, index) => h("span", {
                  key, "data-difficulty-step": key,
                  style: { left: `${100 * index / (DIFFICULTY_ORDER.length - 1)}%` }
                }, LEVELS[key].label))
              )
            ),
            h(Button, { type: "button", id: "difficulty-bot-open", className: "difficulty-bot-link", variant: "ghost", "aria-controls": "difficulty-bot-view" },
              h("span", null, "Bot profile"),
              h("span", { id: "difficulty-active-bot" }, BOT_PROFILES.default.label),
              h(Icon, { name: "caret-right" })
            )
          ),
          h("div", { id: "difficulty-bot-view", className: "difficulty-view bot-list-view", hidden: true },
            h("div", { className: "bot-list-head" },
              h(Button, { type: "button", id: "difficulty-bot-back", className: "icon-button bot-list-back", "aria-label": "Back to bot difficulty", variant: "ghost", size: "icon" },
                h(Icon, { name: "arrow-left" })
              ),
              h("span", { className: "bot-list-title" }, "Bot profile")
            ),
            h("div", { id: "difficulty-bot-list", className: "bot-list", role: "listbox", "aria-label": "Bot profiles" })
          )
        )
      )
    ),
    h(Alert, { id: "game-result", className: "result", hidden: true },
      h("div", { className: "result-heading" },
        h("span", { id: "result-icon", className: "outcome-icon", "aria-hidden": "true" }),
        h("strong", { id: "result-title" })
      ),
      h("p", { id: "result-reason" }),
      h(Button, { type: "button", id: "review-open", variant: "default" },
        h(Icon, { name: "magnifying-glass" }),
        h("span", null, "Game Review")
      )
    ),
    h(Alert, { id: "bot-error", className: "notice", hidden: true },
      h("p", { id: "bot-message", role: "status" }),
      h(Button, { type: "button", id: "bot-retry", variant: "outline" },
        h(Icon, { name: "arrow-clockwise" }),
        h("span", null, "Retry bot")
      )
    ),
    h(Alert, { id: "match-conflict", className: "notice", hidden: true },
      h("p", { role: "status" }, "Another tab changed the saved match. Reload to continue that match."),
      h(Button, { type: "button", id: "reload-match", variant: "outline" }, "Reload saved match")
    ),
    h(ButtonGroup, { className: "action-row play-actions" },
      h(Button, { type: "button", id: "new-game", variant: "default" },
        h(Icon, { name: "plus" }),
        h("span", null, "New game")
      ),
      h(Button, { type: "button", id: "undo", variant: "outline" },
        h(Icon, { name: "arrow-u-up-left" }),
        h("span", null, "Undo")
      ),
      h(Button, { type: "button", id: "resign", variant: "outline" },
        h(Icon, { name: "flag" }),
        h("span", null, "Resign")
      ),
      h(Button, { type: "button", id: "claim-draw", variant: "outline", hidden: true }, "Claim draw"),
      h(Button, { type: "button", id: "past-reviews", hidden: true, variant: "outline" },
        h(Icon, { name: "clock-counter-clockwise" }),
        h("span", null, "Past reviews")
      )
    ),
    h(CardContent, { className: "panel-section" },
      h("h2", null, "Moves"),
      h("p", { id: "play-empty", className: "muted" }, "Moves appear here as you play."),
      h("ol", { id: "play-moves", className: "move-list", "aria-label": "Moves played" })
    )
  );
}

function ReviewPanel() {
  return h(Card, { id: "review-panel", className: "panel", "aria-labelledby": "review-title", hidden: true },
    h(CardHeader, { className: "review-toolbar" },
      h("div", { className: "review-heading" },
        h(Button, { type: "button", className: "back-to-play", "data-go": "play", variant: "ghost" },
          h(Icon, { name: "arrow-left" }),
          h("span", null, "Back to Play")
        ),
        h(CardTitle, { id: "review-title", tabIndex: -1 }, "Game Review")
      ),
      h(NativeSelect, { id: "review-games", "aria-label": "Completed game", hidden: true })
    ),
    h(CardContent, { id: "review-empty", className: "panel-section" },
      h("p", { className: "muted" }, "Finish a game against Stockfish to review it here."),
      h(Button, { type: "button", "data-go": "play", variant: "default" },
        h(Icon, { name: "strategy" }),
        h("span", null, "Go to Play")
      )
    ),
    h("div", { id: "review-content", hidden: true },
      h("div", { id: "review-progress", className: "panel-inset review-progress", hidden: true },
        h("p", { id: "review-message", role: "status" }),
        h("div", { id: "review-meter" }),
        h(Button, { type: "button", id: "review-retry", hidden: true, variant: "outline" },
          h(Icon, { name: "arrow-clockwise" }),
          h("span", null, "Retry analysis")
        )
      ),
      h(ReviewTabs, null,
        h(TabsList, { id: "review-tabs", className: "review-tabs", "aria-label": "Game review views" },
          h(TabsTrigger, { "data-review-tab": "inspect", value: "inspect" },
            h(Icon, { name: "magnifying-glass" }),
            h("span", null, "Analysis")
          ),
          h(TabsTrigger, { "data-review-tab": "moves", value: "moves" },
            h(Icon, { name: "list-numbers" }),
            h("span", null, "Moves")
          ),
          h(TabsTrigger, { "data-review-tab": "accuracy", value: "accuracy" },
            h(Icon, { name: "gauge" }),
            h("span", null, "Accuracy ", h("span", { id: "review-tab-score", hidden: true }))
          )
        ),
        h(TabsContent, { className: "review-pane", value: "inspect", forceMount: true },
          h("div", { id: "review-detail", className: "move-detail" })
        ),
        h(TabsContent, { className: "review-pane", value: "moves", forceMount: true },
          h("ol", { id: "review-moves", className: "move-list review-move-list", "aria-label": "Select a move to review" })
        ),
        h(TabsContent, { className: "review-pane", value: "accuracy", forceMount: true },
          h("p", { id: "review-accuracy-pending", className: "muted" }, "Game accuracy appears when every move has been analyzed."),
          h("div", { id: "review-summary", hidden: true },
            h("div", { className: "accuracy-heading" },
              h("div", null,
                h("h2", { id: "accuracy-heading" }, "Your game accuracy"),
                h("p", { className: "muted" }, "Based on Stockfish’s evaluations")
              ),
              h("strong", { id: "overall-accuracy", className: "accuracy-number" })
            ),
            h("div", { id: "accuracy-details", className: "accuracy-details" })
          )
        )
      )
    )
  );
}

function PracticePanel() {
  return h(Card, { id: "practice-panel", className: "panel", "aria-labelledby": "practice-title", hidden: true },
    h(CardHeader, { className: "panel-header" },
      h(CardTitle, { id: "practice-title" }, "Practice positions"),
      h(CardDescription, null, "Try a new move in a position from one of your games.")
    ),
    h(CardContent, { id: "practice-empty", className: "panel-section" },
      h("p", { className: "muted" },
        "Choose ",
        h("strong", null, "Practice"),
        " in a move’s analysis to add the position here."
      ),
      h(Button, { type: "button", "data-go": "play", variant: "default" },
        h(Icon, { name: "strategy" }),
        h("span", null, "Go to Play")
      )
    ),
    h(CardContent, { id: "practice-content", className: "panel-section", hidden: true },
      h("div", { className: "field" },
        h(Label, { htmlFor: "practice-positions" }, "Saved position"),
        h(NativeSelect, { id: "practice-positions" })
      ),
      h("div", { className: "practice-task" },
        h("div", { className: "practice-task-heading" },
          h("h2", { id: "practice-task-title" }),
          h(Badge, { id: "practice-task-grade", hidden: true })
        ),
        h("p", { id: "practice-task-text", className: "muted" }),
        h(AlertDescription, { id: "practice-feedback", className: "notice", role: "status", hidden: true })
      ),
      h(ButtonGroup, { className: "action-row" },
        h(Button, { type: "button", id: "practice-hint", variant: "outline" },
          h(Icon, { name: "lightbulb" }),
          h("span", null, "Show hint")
        ),
        h(Button, { type: "button", id: "practice-reset", variant: "outline" },
          h(Icon, { name: "arrow-clockwise" }),
          h("span", null, "Reset position")
        ),
        h(Button, { type: "button", id: "practice-review", variant: "outline" },
          h(Icon, { name: "magnifying-glass" }),
          h("span", null, "Open review")
        )
      ),
      h("p", { id: "practice-hint-text", className: "hint", role: "status", hidden: true })
    )
  );
}

function Workspace() {
  return h("main", { className: "studio" },
    h(Alert, { id: "storage-message", className: "notice", role: "status", hidden: true }),
    h("div", { className: "workspace" },
      h(BoardArea),
      h("div", { className: "sidebar" }, h(PlayPanel), h(ReviewPanel), h(PracticePanel))
    )
  );
}

export function mountStudio() {
  renderUI(document.getElementById('studio-root'), h(Fragment, null, h(SiteHeader), h(Workspace)));
}
