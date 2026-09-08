# Sonoff Zigbee

Homey app adding support for SONOFF Zigbee devices.

Fork of the original app by StyraHem — their last version published to
GitHub was **v1.7.0** (preserved on the [`backup`](https://github.com/macmonty/Homey.Sonoff.Zigbee/tree/backup) branch). This fork
continues from there with community-added device support and fixes.

**Current version: 1.16.1** — latest version published to this repository (`master`).

## Changelog (fixes)

- **v1.16.1** (latest published) — Added SNZB-09P (siren): activate/cancel via on/off, sound/light/volume/duration presets as settings, tamper alarm and battery. Built from documentation only, not yet verified against real hardware.
- **v1.16.0** — Silenced harmless but noisy log errors from Sonoff scene buttons (e.g. SNZB-01M) using their remote-control feature (group/identify/on-off commands to other devices), which no driver handled. Removed a validation warning on S60ZBTPF caused by a redundant energy setting (it only measures import, not export).
- **v1.15.2** — Zigbee attribute write rejections (e.g. `MALFORMED_COMMAND`, `UNSUPPORTED_ATTRIBUTE`) are now logged with the exact attribute name and reason, instead of being silently swallowed.
- **v1.15.1** — Added MINI-ZBDIM, ZBMINI, MINI-ZB1GS and MINI-ZB1GSP. Fixed power/voltage/current readings on S60ZBTPF and MINI-ZBDIM (wrong cluster). Added calibration, delayed power-on and power-protector support where applicable. ZBMINIR2 now also matches MINI-ZBD (dry-contact relabel, same firmware). Restored real OTA firmware for 21 drivers.

## Supported devices (grouped by the version each was added in)

| Version | Devices |
|---|---|
| v1.0.9 | SNZB-02 (Square thermometer), SNZB-02D (Thermometer with display) |
| v1.0.12 | SNZB-04 (Door/window contact) |
| v1.0.14 | SNZB-03 (Motion detector), SNZB-06P (Presence detector) |
| v1.2.0 | ZBMINI-L (Switch), ZBMINI-L2 (Switch), RF/TX devices (send and receive) |
| v1.4.0 | ZBTRV (Radiator valve), SNZB-03P (Motion detector), SNZB-04P (Door/window contact) |
| v1.5.0 | ZBCurtain (Curtain) |
| v1.6.2 | SNZB-05P (Water leak sensor) |
| v1.7.0 | ZBMINIR2 (Switch with external button) |
| v1.7.1 | SWV (Water valve) |
| v1.7.2 | ZBMicro (USB switch) |
| v1.7.3 | SNZB-02WD (Outdoor thermometer) |
| v1.7.9 | S60ZBTPF (Wall plug with power monitoring) |
| v1.9.0 | SNZB-02DR2 (Thermometer with display) |
| v1.10.0 | SNZB-01M (4-in-1 button) |
| v1.12.0 | DUO (2-channel switch, neutral required), DUO-L (2-channel switch, no neutral) |
| v1.13.0 | BASICZBR3 (Smart switch), MINI-ZBRBS (Roller shutter switch) |
| v1.14.0 | DUO — separate channels driver |
| v1.15.0 | DUO-L — separate channels driver, ZBM5 (Wall switch, 1/2/3-channel — separate channel drivers added) |
| v1.15.1 | MINI-ZBDIM (Smart dimmer), ZBMINI (Switch), MINI-ZB1GS (Smart switch), MINI-ZB1GSP (Smart switch with power monitoring), MINI-ZBD (Dry-contact switch) |
| v1.16.1 | SNZB-09P (Siren) |
| *(exact version not recorded)* | SNZB-01 (Square button), SNZB-01P (Round button), SNZB-02P (Round thermometer), SNZB-02LD (Outdoor thermometer with probe — existed before v1.7.3) |

> Note: version numbers were renumbered during development to align with the actual App Store release line (starting at v1.15.0). Both tables above use the current, consistent numbering.

See [`docs/DEVELOPMENT_NOTES.md`](docs/DEVELOPMENT_NOTES.md) for detailed technical notes on non-obvious decisions and investigations.
