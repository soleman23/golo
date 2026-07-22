# ⛳ Golf Skins Game
## Complete Rules, Betting Logic & Implementation Guide

***

## What Is Skins?

Skins is golf's most popular hole-by-hole betting format. Each of the 18 holes has a monetary value — called a "skin" — attached to it. The player who posts the **sole lowest score** on a hole wins that skin. If two or more players tie for the lowest score, **nobody wins**, and the value carries forward to the next hole, stacking the prize and building tension.[^1][^2]

The beauty of Skins is that every hole is its own mini-contest. A player can be getting crushed on the scorecard and still win big by winning the right hole at the right time — especially if a carryover has been building for several holes.[^3]

***

## Game Setup

Before teeing off, the group agrees on three things:

1. **Number of players** — Works with 2–8 players; the classic format is 3 or 4[^3]
2. **Scoring type** — Gross (raw strokes, no handicap) or Net (handicap-adjusted)[^4]
3. **Betting structure** — How much each skin is worth (see below)

***

## The Two Betting Structures

### 🏦 Structure 1 — Per-Skin (Pay-Each-Other) Mode

Each skin has a **fixed flat dollar value** agreed upon before the round. Every time someone wins a skin, each of the other players pays them that amount.[^5]

**Example: 4 players, $5 per skin**

| Event | Winner | Each Loser Pays | Winner Collects Net |
|---|---|---|---|
| Player A wins Hole 1 outright | Player A | $5 each × 3 players | **+$15** |
| Hole 2 ties — carryover | Nobody | — | — |
| Hole 3 ties — carryover | Nobody | — | — |
| Player B wins Hole 4 outright | Player B | $5 × 3 skins × 3 players | **+$45** |

When a carryover happens, the **number of skins** stacks — not just the dollar amount. After 3 consecutive ties, the next hole is worth **4 skins** (the original + 3 carried over). At $5/skin with 3 losers paying, that hole is worth $5 × 4 skins × 3 players = **$60** to the winner.[^6][^5]

> **App Logic:** Track a `carryover_count` variable starting at 1 for each hole. Add 1 every time a hole ties. Multiply: `skin_value × carryover_count × (num_players - 1)` = net payout to winner.

***

### 💰 Structure 2 — Buy-In Pot Mode

All players contribute a fixed buy-in amount before the round. The total pot is divided by the total number of skins won across 18 holes to produce a **per-skin payout value**.[^7][^8]

**Example: 4 players, $20 buy-in each**

- Total pot = $20 × 4 = **$80**
- If 5 skins are won across 18 holes → $80 ÷ 5 = **$16 per skin**

| Player | Skins Won | Gross Payout | Minus Buy-in | Net Result |
|---|---|---|---|---|
| Player A | 3 skins | $48 | −$20 | **+$28** |
| Player B | 2 skins | $32 | −$20 | **+$12** |
| Player C | 0 skins | $0 | −$20 | **−$20** |
| Player D | 0 skins | $0 | −$20 | **−$20** |

> **App Logic:** Count total skins won. Divide pot by that count to get `skin_payout`. Multiply each player's `skins_won × skin_payout`. Subtract their buy-in. The result is their net win or loss.

***

## Hole-by-Hole Scoring Logic

This is the core engine of the game:[^1][^6]

1. All players complete the hole, counting every stroke and penalty
2. Compare scores — lowest score wins; ties go to no one
3. **If there is a sole winner:** They claim all accumulated skins; `carryover_count` resets to 1 for the next hole
4. **If there is a tie (even if one player is not the low score — only the low score ties matter):** No skin awarded; `carryover_count` increments by 1 for the next hole
5. Repeat for all 18 holes

### Complete Worked Example — 4 Players, $5/Skin

| Hole | Alex | Ben | Carlos | Dana | Low Score | Winner | Skins Worth | Carryover → |
|---|---|---|---|---|---|---|---|---|
| 1 | 4 | **3** | 5 | 4 | 3 (Ben only) | **Ben** | $5 × 1 = **$5** | 1 |
| 2 | **4** | **4** | 5 | 5 | 4 (Alex & Ben tie) | Nobody | $5 × 1 | 2 |
| 3 | 3 | **3** | **3** | 4 | 3 (three-way tie) | Nobody | $5 × 2 | 3 |
| 4 | 5 | 4 | **3** | 4 | 3 (Carlos only) | **Carlos** | $5 × 3 = **$15** | 1 |
| 5 | **3** | 4 | 4 | 4 | 3 (Alex only) | **Alex** | $5 × 1 = **$5** | 1 |
| 6–18 | ... | ... | ... | ... | ... | ... | ... | ... |

By Hole 4, Carlos wins **3 skins** because holes 2 and 3 both tied and carried over. In Per-Skin mode with 4 players, Carlos nets $15 × 3 other players = **$45 from that one hole**.[^9][^5]

***

## Carryovers — The Core Mechanic

Carryovers are what make Skins exciting and unpredictable. Here's how they stack:[^3]

| Consecutive Ties | Next Hole Worth (at $5/skin) | Net to Winner (4 players) |
|---|---|---|
| 0 (normal hole) | $5 × 1 skin | **$15** |
| 1 tie | $5 × 2 skins | **$30** |
| 2 ties | $5 × 3 skins | **$45** |
| 3 ties | $5 × 4 skins | **$60** |
| 4 ties | $5 × 5 skins | **$75** |
| 5 ties | $5 × 6 skins | **$90** |

A $5 game becomes a **$90 moment** if five holes in a row go without a winner — that's how casual rounds turn into unforgettable memories.[^3]

> **App Logic:** Display a "🔥 X Skins Riding" badge on the scorecard for any hole where `carryover_count > 1`. Consider a push notification or animation when a big carryover hole is reached.

***

## Net vs. Gross Scoring

| Mode | How It Works | Best For |
|---|---|---|
| **Gross Skins** | Raw stroke count only, no handicap adjustments | Same-skill groups, scratch golfers |
| **Net Skins** | Handicap strokes subtracted before comparing | Mixed-skill groups, keeps it fair |
| **Hybrid Skins** | Net scoring applies, but gross beats net on ties[^10] | Competitive mixed groups |

**Net Skins Example:** A 12-handicap player gets a stroke on Hole 7 (rated as a handicap hole). If they make a 5 (bogey), their net score is **4**, which may beat a scratch golfer's actual 4 (par). Net player wins the skin.[^11][^4]

> **App Logic:** Load the course's handicap hole ratings (1–18). For each player, determine which holes they receive strokes on based on their handicap index. Apply stroke adjustments before comparing scores on each hole.

***

## What Happens on Hole 18?

If skins are still unclaimed (unresolved carryover) when the round ends, the most common options are:[^12][^6]

1. **Split the remaining pot** — Divide the unawarded value equally among all players (most casual-friendly)
2. **Sudden death playoff** — The group plays additional holes until someone wins outright
3. **Winner takes all** — The player with the most skins won claims the unresolved amount (less common)

> **App Logic:** Offer the group a setting to choose their end-of-round resolution rule before the round starts: `split` | `playoff` | `winner_takes_all`.

***

## Quick Payout Formulas

### Per-Skin Mode (Pay-Each-Other)
```
Hole Payout to Winner = skin_value × carryover_count × (num_players − 1)

Player Net Result = Σ(skins won × skin_value × (num_players − 1))
                 − Σ(skins lost × skin_value)
```

### Pot/Buy-In Mode
```
skin_payout_value = total_pot ÷ total_skins_won_across_18_holes

Player Gross Payout = player_skins_won × skin_payout_value
Player Net Result   = Player Gross Payout − buy_in_amount
```

***

## Full Settlement Example — 18 Holes

**Setup:** 4 players (Alex, Ben, Carlos, Dana) | $5 per skin | Per-Skin mode | Gross scoring

After a full round, here's a realistic skin distribution:

| Hole | Winner | Skins Value | Carryover at Start |
|---|---|---|---|
| 1 | Alex | 1 skin | 1 |
| 2 | Nobody (tie) | — | → 2 |
| 3 | Ben | 2 skins | 2 |
| 4 | Nobody (tie) | — | → 2 |
| 5 | Nobody (tie) | — | → 3 |
| 6 | Carlos | 3 skins | 3 |
| 7 | Alex | 1 skin | 1 |
| 8 | Nobody (tie) | — | → 2 |
| 9 | Dana | 2 skins | 2 |
| 10 | Nobody (tie) | — | → 2 |
| 11 | Alex | 2 skins | 2 |
| 12–14 | Nobody (3 ties) | — | → 4 |
| 15 | Ben | 4 skins | 4 |
| 16 | Carlos | 1 skin | 1 |
| 17 | Nobody (tie) | — | → 2 |
| 18 | Dana | 2 skins | 2 |

**Skins Won:** Alex: 4 | Ben: 6 | Carlos: 4 | Dana: 4 → Total skins: 18 ✅

**Net Settlement (Per-Skin, $5, 4 players → $15 per skin to winner):**

| Player | Skins Won | Gross Earnings | Net vs Others | Approx Net |
|---|---|---|---|---|
| Alex | 4 | 4 × $15 = $60 | Paid out 14 × $5 = $70 | **−$10** |
| Ben | 6 | 6 × $15 = $90 | Paid out 12 × $5 = $60 | **+$30** |
| Carlos | 4 | 4 × $15 = $60 | Paid out 14 × $5 = $70 | **−$10** |
| Dana | 4 | 4 × $15 = $60 | Paid out 14 × $5 = $70 | **−$10** |

Ben wins the round by a healthy margin thanks to claiming the big 4-skin carryover on Hole 15.[^6][^9]

***

## The Five Skins Types

These are the five skin types that can be active in any round. Each is independent — a single hole can award multiple skins if a player satisfies more than one condition simultaneously. Toggle each skin type on/off before the round starts and assign it its own dollar value.[^2][^13]

***

### 1. 🏌️ Standard Skin — Low Score on the Hole

**What triggers it:** The player who posts the sole lowest score on the hole.
**When it's awarded:** Immediately when the hole is completed, as long as no one else ties the low score.
**Carryover:** Yes — if two or more players tie the low score, the skin carries to the next hole and stacks.

| Scenario | Result |
|---|---|
| Alex shoots 4, everyone else shoots 5+ | Alex wins 1 Standard Skin |
| Alex and Ben both shoot 4 | Tie — skin carries forward |
| Hole 2 also ties, Carlos wins Hole 3 | Carlos wins 3 Standard Skins |

**Payout Example (4 players, $5/skin, 1 carryover):** $5 × 2 skins × 3 players = **$30**

> **App Logic:** This is the base skin engine. Track `carryover_count` (starts at 1, increments on each tie, resets to 1 on a win). Payout = `skin_value × carryover_count × (num_players − 1)`.

***

### 2. 🐦 Birdie Skin

**What triggers it:** Any player who makes a birdie (1 under par) or better on a hole.
**When it's awarded:** Awarded regardless of whether they win the Standard Skin — this is its own independent skin.
**Carryover:** No — an unearned Birdie Skin simply doesn't pay; nothing banks to the next hole.

| Scenario | Result |
|---|---|
| Alex makes birdie on Hole 5 (par 4, shoots 3) | Alex wins 1 Birdie Skin |
| Alex also had the low score on Hole 5 | Alex wins both a Standard Skin AND a Birdie Skin |
| Alex and Ben both birdie Hole 5 | Both win a Birdie Skin — no tie, no carry |
| Alex makes eagle on Hole 12 | Eagle Skin triggers (see below) — Birdie Skin also triggers if Birdie is enabled separately |

**Payout Example (4 players, $5/birdie skin):** Alex pockets $5 × 3 players = **$15** just for the birdie, on top of any Standard Skin winnings.

> **App Logic:** After recording each hole score, check: `if player_score <= hole_par - 1`. Award a Birdie Skin to every player who meets it, paid head-to-head against each opponent. Run this check independently of the Standard Skin logic, and keep no carryover counter.

***

### 3. 🦅 Eagle Skin

**What triggers it:** Any player who makes an eagle (2 under par) or better on a hole.
**When it's awarded:** Awarded as its own flat skin, independent of Standard and Birdie skins. Works exactly like the Birdie Skin, one tier deeper.
**Carryover:** No — an unearned Eagle Skin simply doesn't pay; nothing banks to the next hole.

| Scenario | Result |
|---|---|
| Carlos makes a 3 on a par 5 (eagle) | Carlos wins 1 Eagle Skin |
| Nobody eagles a hole | Nothing pays, and nothing carries to the next hole |
| Two players eagle the same hole | Both win an Eagle Skin — no tie, no carry |
| Hole-in-one on a par 3 | Eagle condition met (2 under par) — Eagle Skin + any Greenie Skin |

**Payout Example (4 players, $10/eagle skin):** Carlos pockets $10 × 3 players = **$30** for the eagle, on top of his Birdie and Standard Skin winnings.

> **App Logic:** Check: `if player_score <= hole_par - 2`. Award an Eagle Skin to every player who meets it, paid head-to-head against each opponent. Run this check independently of the Standard Skin logic, and keep no carryover counter. An eagle also satisfies the birdie condition, so a player who eagles collects both skins when Birdie is enabled.

***

### 4. 🟢 Greenie Skin

**What triggers it:** On **par 3 holes only** — the player whose tee shot lands closest to the pin AND who makes par or better on that hole.
**Both conditions must be met:** If the closest player three-putts or makes bogey, no Greenie is awarded.
**Carryover:** Yes — if no one satisfies both conditions on a par 3, the Greenie carries to the next par 3.

| Scenario | Result |
|---|---|
| Ben is closest on Hole 6 (par 3) and makes par | Ben wins 1 Greenie Skin |
| Ben is closest but three-putts for bogey | No Greenie awarded — carries to next par 3 |
| Two players tie for closest (rare edge case) | No Greenie awarded — carries forward |
| Alex is closest AND makes birdie | Alex wins the Greenie Skin + potentially the Birdie Skin too |

**Eligible Holes:** Par 3s only (typically 4 holes per 18-hole round)
**Payout Example (4 players, $5/greenie, 1 carry from previous par 3):** $5 × 2 carries × 3 players = **$30**

> **App Logic:** On each par 3 hole, prompt the group (or use GPS proximity if available) to mark which player was **Closest to Pin (CTP)**. Store `ctp_player_id` per par 3. After the hole is complete, check: `if ctp_player_id.score <= hole_par`. If both conditions pass, award the Greenie. Track `greenie_carryover_count` that carries specifically hole-to-hole across par 3s — not every hole.

***

### 5. ⛱️ Sandie Skin

**What triggers it:** A player who hits their ball into a **sand bunker** during a hole AND **still makes par or better** on that hole.
**Both conditions must be met:** In the bunker + par or better = Sandie. Bogey or worse = no Sandie.
**Carryover:** Usually no — Sandies are typically flat awards per occurrence, not carried. Some groups do carry them.

| Scenario | Result |
|---|---|
| Dana hits into a greenside bunker, blasts out, and one-putts for par | Dana wins 1 Sandie Skin |
| Dana hits into a bunker and makes bogey | No Sandie |
| Dana hits into a fairway bunker AND a greenside bunker but still makes par | Dana wins 1 Sandie (condition is simply: was in a bunker, made par) |
| Two players both get Sandies on the same hole | Both players independently win a Sandie Skin from the others |

**Payout Example (4 players, $3/sandie):** Dana pockets $3 × 3 players = **$9** for the Sandie, independent of who won the Standard Skin on that hole.

> **App Logic:** Add a toggle button on the scorecard UI for each hole: **"In Bunker?"** — players self-report during scoring. After the hole score is entered, check: `if bunker_flag === true && player_score <= hole_par`. If both are true, award a Sandie Skin. Since multiple players can earn Sandies on the same hole, loop through all players independently. No shared carryover needed.

***

## How Multiple Skins Stack on One Hole

A single player can win multiple skins on a single hole. Here's a realistic big-hole scenario:

**Setup:** 4 players | Hole 14 (par 5) | All 5 skin types active

| Skin Type | Condition | Met? | Payout |
|---|---|---|---|
| Standard Skin | Lowest score, sole winner, 2 carries | ✅ Carlos | $5 × 3 skins × 3 players = **$45** |
| Birdie Skin | Score of 4 or better on par 5 | ✅ Carlos (made 3) | $5 × 3 players = **$15** |
| Eagle Skin | Score of 3 or better on par 5 | ✅ Carlos (made 3) | $10 × 3 players = **$30** |
| Greenie Skin | Par 3s only | ❌ N/A — this is a par 5 | — |
| Sandie Skin | Carlos was in a bunker, made par or better | ✅ Carlos hit a fairway bunker | $3 × 3 players = **$9** |

**Carlos's total take from Hole 14 alone: $45 + $15 + $30 + $9 = $99**

This is how a $5/$10/$3 game turns into a memorable payout from a single spectacular hole.[^9][^6]

***

## Skin Type Configuration Summary

| Skin Type | Trigger | Eligible Holes | Typical Value | Carryover? | Multi-Award per Hole? |
|---|---|---|---|---|---|
| **Standard** | Sole low score | All 18 | Set by group | ✅ Yes | No (1 winner) |
| **Birdie** | Score = par − 1 or better | All 18 | Set by group | No | ✅ Yes (multiple birdies) |
| **Eagle** | Score = par − 2 or better | All 18 | Set by group | No | ✅ Yes (multiple eagles) |
| **Greenie** | CTP on par 3 + par or better | Par 3s only | Set by group | ✅ Yes (par 3 to par 3) | No (1 CTP per hole) |
| **Sandie** | In bunker + par or better | All 18 | Set by group | Optional | ✅ Yes (multiple players) |

> **App Logic:** Model each skin type as an independent `SkinType` object with `enabled: boolean`, `value: number`, `carryover_enabled: boolean`, and `carryover_count: number`. Evaluate all enabled skin types after each hole and sum all payouts before moving to the next hole.

***

## App Data Model Recommendations

```
Round {
  players: Player[]
  bet_structure: "per_skin" | "pot"
  skin_value: number        // per-skin dollar amount OR buy-in amount
  scoring_type: "gross" | "net" | "hybrid"
  back_nine_multiplier: number  // 1 = flat, 2 = double back nine
  end_of_round_rule: "split" | "playoff" | "winner_takes_all"
  side_bets: SideBet[]
}

Hole {
  hole_number: 1–18
  par: number
  handicap_rating: 1–18   // for net scoring
  carryover_count: number  // running total of unclaimed skins entering this hole
  scores: { player_id, strokes }[]
  winner_id: string | null  // null = tied
  skins_awarded: number
}

Settlement {
  player_id: string
  skins_won: number
  gross_earnings: number
  amount_paid_out: number
  net_result: number       // positive = won, negative = lost
}
```

***

*This document was built for integration into a golf scoring and betting app. All rules follow standard casual-play conventions as widely practiced across the United States golf community.*

---

## References

1. [Skins Golf Game: Official Rules, Scoring & Strategy Guide](https://www.golfgameshub.com/skins-golf-game-rules-strategy-scoring/) - Learn how the Skins golf game works. Complete rules, scoring, carryovers, handicaps, and strategy so...

2. [How to Play Skins in Golf — Setup, Carryovers & Payouts (2026)](https://settleup-golf.com/how-to/skins) - How to play Skins in golf — wager per skin, carryovers on ties, hole-by-hole payouts, setup tips, an...

3. [Frequently Asked Questions](https://stickapp.golf/games/skins/) - Skins is golf's hole-by-hole betting game. Win the hole outright and take the skin. Learn carryovers...

4. [What is Skins in Golf? A Comprehensive Guide - Humble Golfer](https://humblegolfer.com/what-is-skins-in-golf/) - Get a better understanding of Skins in Golf with our comprehensive guide, covering rules, variations...

5. [Skins Game Calculator — Free Hole-by-Hole Payout Math ...](https://settleup-golf.com/tools/skins-calculator) - Free skins game calculator for 2-6 players. Enter hole-by-hole scores, set the skin value, and see w...

6. [Golf Skins Game: Rules, Carryovers & How to Calculate Payouts](https://www.runpools.com/blog/skins-game-rules) - Exactly how skins work: what happens on a tie, when they carry over, and a quick way to calculate wh...

7. [Betting Tips To Win Big At...](https://18birdies.com/clubhouse/golf-games/skins-golf-betting-game-play-win/) - The #1 RATED GOLF GPS APP. Get distances with GPS, keep score, track shots, and more – all the tools...

8. [Calculating Skin payouts?](https://www.reddit.com/r/golf/comments/bpy8cm/calculating_skin_payouts/)

9. [Skins in Golf | How to Play it? - Druids](https://www.druids.com/blogs/golf/skins-in-golf) - The winner of the hole is the one with the lowest score, and he receives the skin for that hole (pri...

10. [Leaderboards - Skins (Gross/Net/Hybrid) - HelpDocs](https://help.unknowngolf.com/article/uwi0vakjf8-leaderboards-skins-gross-net-hybrid) - Gross Skins - no handicaps, everything is straigh up · Net Skins - using handicap settings, and awar...

11. [How The Scorecard And GPS Works](https://support.gallusgolf.com/portal/en/kb/articles/how-the-scorecard-gps-works) - What's The Point? The Scorecard & GPS section of a Gallus Golf custom-branded mobile app allows user...

12. [Golf Skins Game: Everything You Need to Know](https://www.golflink.com/lifestyle/golf-skins-game-everything-you-need-to-know) - A complete explanation of golf's skins game with rules, add-ons and variations.

13. [HELP! with Scoring / Settling up Skins game w/ KP, LD, Side-bets, etc...](https://www.reddit.com/r/golf/comments/u6izk9/help_with_scoring_settling_up_skins_game_w_kp_ld/)

