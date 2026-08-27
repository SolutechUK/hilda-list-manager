# H.I.L.D.A Multi List

**H.I.L.D.A Multi List** is a Home Assistant custom integration and dashboard card for managing multiple To-do lists from one compact interface.

This is the first **community beta**.

## Features

- Use existing Home Assistant `todo.*` entities
- Create persistent H.I.L.D.A-managed To-do lists directly from the card editor
- Rename and safely delete H.I.L.D.A-managed lists from the integration settings
- Switch between any number of lists in one card
- Add, complete and uncomplete items
- **Mark Done** and **Clear** built into the card
- Per-list image or searchable Home Assistant icon
- Optional manual **Send List**
- Send to `notify.*` entities or `rest_command.*` services
- Optional **Send on Zone**
  - enter or leave
  - searchable Person selector
  - searchable Zone selector
  - configurable cooldown
- Selected list can persist in the browser
- Safe fallback when all lists are removed

## Beta status

`0.4.0-beta.5` is intended for community testing. Back up Home Assistant before testing custom integrations, and initially use disposable H.I.L.D.A-managed lists.

## Install with HACS as a custom repository

Until the repository is accepted as a HACS default:

1. HACS → Integrations.
2. Open **Custom repositories**.
3. Add:
   `https://github.com/SolutechUK/hilda-list-manager`
4. Category: **Integration**.
5. Install **H.I.L.D.A Multi List**.
6. Restart Home Assistant.
7. Settings → Devices & services → **Add Integration** → **H.I.L.D.A Multi List**.

The dashboard card module is registered automatically. **No manual Dashboard Resource is required.**

## Add the card

Add **H.I.L.D.A Multi List** from the dashboard card picker.

A new card starts with one generic entry. In the visual editor you can:

- point it at an existing Home Assistant To-do list, or
- choose **Create new Hilda list**.

### Switching between lists

If your H.I.L.D.A card contains more than one list, the current list name is shown in the pill near the top of the card.

- **Click/tap the list name** to move to the next configured list.
- The icon/image, item count and To-do items update to match the selected list.
- H.I.L.D.A remembers the selected list in your browser.
- Lists can be added, removed, renamed and reordered from the card's visual editor.
- Existing Home Assistant `todo.*` entities can be used alongside H.I.L.D.A-managed lists.

For example, a card containing `Asda → Costco → Parentals → Home to Reaseheath → Reaseheath to Home` can be cycled through simply by tapping the list-name pill.

## Send List

For each list, optionally choose:

- **Notify entity**, or
- **REST command**.

H.I.L.D.A reads the current pending items and sends the actual list, for example:

```text
Costco:
- Milk
- Coffee
- Cat food
```

If the list is empty, H.I.L.D.A sends an empty-list message instead.

## Send on Zone

A list can optionally send automatically when a person enters or leaves a Home Assistant zone.

Example:

- Send List: REST command
- Destination: `rest_command.whatsapp_matt`
- Zone trigger: Enter zone
- Person: `person.matt_sol`
- Zone: `zone.costco`
- Cooldown: 10 minutes

The rule runs in the integration backend, so the dashboard does not need to be open.

## Managed vs external lists

H.I.L.D.A distinguishes between:

- **H.I.L.D.A-managed lists** — created by this integration and stored locally.
- **External lists** — existing `todo.*` entities from other Home Assistant integrations.

H.I.L.D.A can rename/delete its own managed lists. It will not delete an external list.

## Community beta checklist

Please test:

- creating a H.I.L.D.A list
- adding/ticking/unticking items
- Mark Done
- Clear
- renaming a managed list
- deleting a managed list
- deleting the final list
- adding an existing external `todo.*`
- manual Send List
- zone enter/leave sending
- cooldown behavior
- browser/dashboard reload behavior

Please file bugs with Home Assistant version, H.I.L.D.A version, reproduction steps and relevant logs.

## Repository

GitHub: `https://github.com/SolutechUK/hilda-list-manager`

For HACS custom repository installation, use that repository URL and select **Integration**.

## HACS / validation

This repository includes:

- `hacs.json`
- HACS validation GitHub Action
- Hassfest GitHub Action
- release workflow
- brand assets
- issue templates

HACS requires a public GitHub repository for community distribution. The integration repository must contain only one integration under `custom_components/`, and its manifest needs the expected metadata. The repository should also have description/topics and issues enabled.

## License

MIT
