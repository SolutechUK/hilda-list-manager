# H.I.L.D.A Multi List

**H.I.L.D.A Multi List** is a Home Assistant custom integration and dashboard card for managing multiple To-do lists from one compact interface.

This is the first **community beta**.

## Features

* Use existing Home Assistant `todo.\*` entities
* Create persistent H.I.L.D.A-managed To-do lists directly from the card editor
* Rename and safely delete H.I.L.D.A-managed lists from the integration settings
* Switch between any number of lists in one card
* Add, complete and uncomplete items
* **Mark Done** and **Clear** built into the card
* Per-list image or searchable Home Assistant icon
* Optional manual **Send List**
* Send to `notify.\*` entities or `rest\_command.\*` services
* Optional **Send on Zone**

  * enter or leave
  * searchable Person selector
  * searchable Zone selector
  * configurable cooldown
* Selected list can persist in the browser
* Safe fallback when all lists are removed

## Beta status

`0.4.0-beta.3` is intended for community testing. Back up Home Assistant before testing custom integrations, and initially use disposable H.I.L.D.A-managed lists.

## Install with HACS as a custom repository

Until the repository is accepted as a HACS default:

1. HACS → Integrations.
2. Open **Custom repositories**.
3. Add:
`https://github.com/SolutechUK/hilda-list-manager`
4. Category: **Integration**.
5. Install **H.I.L.D.A Multi List**.
6. Restart Home Assistant.
7. Settings → Devices \& services → **Add Integration** → **H.I.L.D.A Multi List**.

### Dashboard resource

For this beta, add one JavaScript module resource manually:

`/hilda\_list\_manager/multi-list-card.js?v=0.4.0-beta.3`

Then hard-refresh the browser.

## Add the card

Add **H.I.L.D.A Multi List** from the dashboard card picker.

A new card starts with one generic entry. In the visual editor you can:

* point it at an existing Home Assistant To-do list, or
* choose **Create new Hilda list**.

## Send List

For each list, optionally choose:

* **Notify entity**, or
* **REST command**.

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

* Send List: REST command
* Destination: `rest\_command.whatsapp\_matt`
* Zone trigger: Enter zone
* Person: `person.matt\_sol`
* Zone: `zone.costco`
* Cooldown: 10 minutes

The rule runs in the integration backend, so the dashboard does not need to be open.

## Managed vs external lists

H.I.L.D.A distinguishes between:

* **H.I.L.D.A-managed lists** — created by this integration and stored locally.
* **External lists** — existing `todo.\*` entities from other Home Assistant integrations.

H.I.L.D.A can rename/delete its own managed lists. It will not delete an external list.

## Community beta checklist

Please test:

* creating a H.I.L.D.A list
* adding/ticking/unticking items
* Mark Done
* Clear
* renaming a managed list
* deleting a managed list
* deleting the final list
* adding an existing external `todo.\*`
* manual Send List
* zone enter/leave sending
* cooldown behavior
* browser/dashboard reload behavior

Please file bugs with Home Assistant version, H.I.L.D.A version, reproduction steps and relevant logs.

## Repository

GitHub: `https://github.com/SolutechUK/hilda-list-manager`

For HACS custom repository installation, use that repository URL and select **Integration**.

## HACS / validation

This repository includes:

* `hacs.json`
* HACS validation GitHub Action
* Hassfest GitHub Action
* release workflow
* brand assets
* issue templates

HACS requires a public GitHub repository for community distribution. The integration repository must contain only one integration under `custom\_components/`, and its manifest needs the expected metadata. The repository should also have description/topics and issues enabled.

## License

MIT





