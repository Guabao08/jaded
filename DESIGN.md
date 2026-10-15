---
name: ShipBrief
description: Review product pushes and turn evidenced changes into marketing drafts.
colors:
  forest-binding: "#153b39"
  forest-stage: "#173e3a"
  terracotta: "#c94f39"
  terracotta-button: "#d66b52"
  paper-ground: "#e9e5dc"
  paper-sheet: "#f4f0e7"
  paper-raised: "#faf7ef"
  ink-primary: "#1b2826"
  ink-secondary: "#4e605b"
  border-soft: "#d4cdbf"
  acetate-green: "#d7e7df"
  acetate-sand: "#eee2cb"
typography:
  display:
    fontFamily: "Frank Ruhl Libre, Georgia, serif"
    fontSize: "clamp(2.4rem, 4.1vw, 3.3rem)"
    fontWeight: 400
    lineHeight: 1.05
  headline:
    fontFamily: "Frank Ruhl Libre, Georgia, serif"
    fontSize: "clamp(1.9rem, 3vw, 2.6rem)"
    fontWeight: 500
    lineHeight: 1.1
  body:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.6
  label:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.3
    letterSpacing: "0.1em"
  mono:
    fontFamily: "DM Mono, monospace"
    fontSize: "11px"
    fontWeight: 400
    lineHeight: 1.4
rounded:
  square: "2px"
  button: "3px"
  control: "7px"
spacing:
  compact: "8px"
  standard: "16px"
  spacious: "24px"
components:
  button-primary:
    backgroundColor: "{colors.terracotta-button}"
    textColor: "#251d19"
    rounded: "{rounded.button}"
    height: "38px"
    padding: "0 11px"
  sheet:
    backgroundColor: "{colors.paper-sheet}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.square}"
    padding: "26px 32px"
  input:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink-primary}"
    rounded: "{rounded.square}"
    padding: "11px 12px"
---

# Design System: ShipBrief

## Overview

**Creative North Star: The Push Ledger.**

ShipBrief should feel like a working release desk: incoming pushes are easy to scan, a draft gets the space of a reading sheet, and its evidence stays within reach on layered source leaves. The interface uses the contrast between a dark green binding and warm paper to make the workflow memorable without turning every region into a decorative card.

The first viewport demonstrates the real job: choose a push, read the draft, and inspect linked sources before approving. Demo data is identified as illustrative. Copy must not imply customer outcomes, performance, live integrations, AI generation, or publishing unless the product actually supports them.

**Key Characteristics:**

- Deep green navigation and push surfaces
- Warm paper draft sheets with a literary display face
- Compact, precise labels and evidence metadata
- Selective dimensionality in push tiles and acetate leaves
- Review remains a human action

## Colors

The palette pairs binding green and warm paper; terracotta marks primary actions and a small number of important states.

### Primary

- **Binding Forest** (#153b39): persistent navigation and the application frame.
- **Push Forest** (#173e3a): the recent-push stage that anchors the overview.
- **Terracotta** (#c94f39): links, active states, and small action marks.
- **Button Terracotta** (#d66b52): primary actions with dark, readable text.

### Secondary

- **Acetate Green** (#d7e7df): commit and repository evidence leaves.
- **Acetate Sand** (#eee2cb): a second source layer, visually distinct from commit evidence.

### Neutral

- **Paper Ground** (#e9e5dc): page background.
- **Paper Sheet** (#f4f0e7): reading surfaces and content panels.
- **Raised Paper** (#faf7ef): editable fields.
- **Primary Ink** (#1b2826): body and heading text on light surfaces.
- **Secondary Ink** (#4e605b): supporting copy on light surfaces.
- **Soft Rule** (#d4cdbf): dividers and low-emphasis borders.

### Named Rules

**The Evidence Stays Close Rule.** Source layers are visible beside a draft or one action away; never detach the draft from its commit context.

## Typography

**Display Font:** Frank Ruhl Libre (with Georgia fallback)  
**Body Font:** DM Sans (with sans-serif fallback)  
**Label/Mono Font:** DM Sans for labels; DM Mono for commit hashes and technical identifiers.

**Character:** A bookish serif gives the draft room to read; a clear, compact sans keeps the app controls and workflow easy to scan. Monospaced text is reserved for actual identifiers and measurements.

### Hierarchy

- **Display** (400, clamp(2.4rem, 4.1vw, 3.3rem), 1.05): the overview title and selected draft title.
- **Headline** (500, clamp(1.9rem, 3vw, 2.6rem), 1.1): page and section headings.
- **Title** (600, 17–19px, 1.2): push and workflow titles.
- **Body** (400, 12–15px, 1.6–1.7): explanatory copy and draft text, kept to readable measures.
- **Label** (600, 11px minimum, 1.3, lightly tracked): source type, channel, status, and other short wayfinding labels.

### Named Rules

**The Draft Has a Reading Voice Rule.** Use the serif for the draft title and longer authored copy; keep navigation and control text in the sans family.

## Layout

The desktop application uses a fixed 250px navigation rail and a fluid content surface capped at 1500px. The overview begins with a horizontal push wall, then places the draft sheet beside a narrow source rail. Lists and data tables use denser rows; workflow cards are grouped in a quiet two-column band. At 820px the application becomes a single content column. At 620px the navigation becomes an accessible drawer, the push wall scrolls horizontally only when it contains multiple tiles, and acetate sources move below the draft sheet. Keep nested grid children shrinkable and identifiers wrapping safely.

## Elevation & Depth

Depth is reserved for the signature objects. Push tiles use a perspective transform, extruded side, and offset shadows to read as small physical cards. Evidence leaves overlap and rotate slightly as if hinged from a binder. Most content stays flat on paper; neutral, soft shadows separate a few major sheets. Do not use colored glow as elevation.

### Shadow Vocabulary

- **Sheet lift** (`0 8px 19px #26382d15`): the draft sheet above the page ground.
- **Tile depth** (`0 13px 18px #0f25243b`): the extruded push tile face and back.
- **Leaf overlap** (`0 5px 10px #20392d19`): acetate source leaves.

## Shapes

The interface favors squared corners that recall a paper ledger and software console. Main sheets and buttons use 2–3px corners; secondary controls can reach 7px. Rules are fine and warm gray. Avoid pill-shaped panels and repeated rounded cards. The layered rectangles of the push tiles and source leaves are the signature silhouette.

## Components

### Buttons

- **Shape:** square, 2–3px corner radius.
- **Primary:** terracotta fill with dark ink; compact 38px height.
- **Hover / Focus:** a small lift on primary actions; clear 2px focus outline in binding green or the contrasting local surface color.
- **Secondary / Ghost:** paper surface with a fine neutral rule; text links use terracotta with an underline on hover.

### Cards / Containers

- **Corner Style:** 2px for sheets and tiles; use a plain rule instead of a second border when a shadow defines elevation.
- **Background:** paper sheet for content; forest green for the push stage.
- **Internal Padding:** 16–24px for ordinary panels and 26–32px for the main draft sheet.
- **Signature:** 3D push tiles and overlapping acetate evidence leaves carry the tactile character.

### Inputs / Fields

- **Style:** warm raised-paper fill, a 1px muted rule, square corners, 11–12px internal padding.
- **Focus:** high-contrast 2px green outline.
- **Error / Disabled:** preserve text contrast and state the recovery in the control's nearby message.

### Navigation

- **Style:** binding-green rail, clear sans labels, square active row on a warm paper fill.
- **Mobile:** a 260px drawer opened by a labeled menu button; selecting a destination closes the drawer.

## Do's and Don'ts

- **Do** keep real changes, commit identifiers, and source links connected to each draft.
- **Do** label sample data and distinguish a draft from published content.
- **Do** reserve 3D transforms and acetate layering for pushes and evidence.
- **Do** preserve readable ink contrast on both paper and forest surfaces.
- **Don't** add performance claims, customers, or launch details absent from product evidence.
- **Don't** imply that approval publishes a draft.
- **Don't** scatter glows, gradients, pills, or ornamental icons across ordinary controls.
- **Don't** use monospace as a generic technical costume or serif for dense metadata.
