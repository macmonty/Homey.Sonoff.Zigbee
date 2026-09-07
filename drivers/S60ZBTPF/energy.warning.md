# Aviso de `homey app validate`: energy.cumulative sin cumulativeExportedCapability

```
Warning: drivers.S60ZBTPF has energy.cumulative set to true, but is missing 'cumulativeExportedCapability'.
```

Este aviso **es intencionado y no requiere corrección**.

## Por qué aparece

`homey-lib` (`lib/App/index.js`, ~línea 595) emite esta advertencia siempre que un driver
tiene `energy.cumulative: true` junto con alguna capability instancia de `meter_power`,
pidiendo tanto:

- `cumulativeImportedCapability` (energía consumida) — ya declarada aquí como `meter_power`.
- `cumulativeExportedCapability` (energía exportada a la red) — pensada para dispositivos
  bidireccionales: paneles solares, baterías domésticas, cargadores EV con V2G, etc.

El validador no distingue el tipo de dispositivo: lanza el mismo aviso para todos los que
tengan `cumulative: true`, sin comprobar si tiene sentido declarar una exportación.

## Por qué no aplica aquí

`S60ZBTPF` es un enchufe inteligente (`Wall Plug`) que solo **consume** energía. Sus
capabilities (`meter_power`, `meter_power_today`, `meter_power_yesterday`,
`meter_power_month`) representan únicamente consumo — no existe ninguna capability de
exportación real que declarar.

Además, el schema exige que `cumulativeExportedCapability` apunte a una instancia válida
de `meter_power`; poner ahí el mismo `meter_power` (o cualquier otro) para silenciar el
aviso haría que Homey tratase el enchufe como si también exportara energía a la red,
distorsionando las gráficas de Insights/Energy con datos falsos.

## Decisión

Dejar `energy` tal cual está en `app.json` (`cumulative: true` +
`cumulativeImportedCapability: "meter_power"`, sin `cumulativeExportedCapability`) e
ignorar el warning en `homey app validate`. No bloquea la validación a nivel `publish`.
