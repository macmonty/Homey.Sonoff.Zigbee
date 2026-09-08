# Notas de desarrollo

Documento técnico de referencia — decisiones no obvias y su porqué, para que
una sesión futura (tuya o de otra IA) no tenga que re-derivarlas desde cero.
Se actualiza cada vez que se toma una decisión de este tipo; no es un
changelog de usuario (eso vive en `.homeychangelog.json` / README).

## Índice
- [Cómo depurar comandos que el dispositivo rechaza](#cómo-depurar-comandos-que-el-dispositivo-rechaza)
- [Historial de versiones de README.txt](#historial-de-versiones-de-readmetxt)
- [Dónde conseguir los firmwares OTA](#dónde-conseguir-los-firmwares-ota)
- [Tipos ZCL construidos a mano](#tipos-zcl-construidos-a-mano)
- [Sesión 2026-09-06 — dispositivos añadidos/modificados](#sesión-2026-09-06--dispositivos-añadidosmodificados)
- [Sesión 2026-09-07 — SNZB-01M no reportaba pulsaciones](#sesión-2026-09-07--snzb-01m-no-reportaba-pulsaciones)
- [Sesión 2026-09-08 — SNZB-09P (sirena) añadido](#sesión-2026-09-08--snzb-09p-sirena-añadido)

---

## Cómo depurar comandos que el dispositivo rechaza

**Hallazgo (2026-09-06):** `writeAttributes()` de `zigbee-clusters` (la
librería de Homey) **resuelve con éxito incluso cuando el dispositivo
rechaza atributos concretos**. El comando `writeAttributes` tiene una
respuesta propia (`response.attributes`, un array de `{id, status}` por cada
atributo — ver `node_modules/zigbee-clusters/lib/Cluster.js`, definición del
comando `writeAttributes` y su `response`), a diferencia de otros comandos
(como `setInching`) que sí usan la "default response" genérica y **sí**
lanzan una excepción cuando el status no es `SUCCESS`
(`node_modules/zigbee-clusters/lib/Cluster.js`, línea ~1057:
`if (response.status !== 'SUCCESS') { throw new Error(response.status); }`).

Antes de este cambio, ningún `device.js` de esta app inspeccionaba ese array
de estados — un rechazo por atributo (`MALFORMED_COMMAND`,
`UNSUPPORTED_ATTRIBUTE`, `INVALID_DATA_TYPE`, etc.) quedaba **silenciado**:
el `try` no lanzaba error, el log decía "Write OK" o similar, y no había
forma de saber que el dispositivo real había ignorado el cambio.

**Solución:** [lib/zclDebug.js](../lib/zclDebug.js) exporta
`writeAttributesVerbose(device, cluster, attributes)` — un wrapper de
`cluster.writeAttributes(attributes)` que además inspecciona la respuesta y
llama a `device.error(...)` por cada atributo con status distinto de
`SUCCESS`, indicando el nombre del atributo (resuelto por id) y el cluster.
Verificado con una prueba aislada (cluster simulado que devuelve un rechazo)
antes de integrarlo — ver el mensaje del commit/turno donde se añadió.

Se sustituyeron **todas** las llamadas a `.writeAttributes(...)` de la app
(9 ficheros: `MINI-ZB1GS`, `MINI-ZB1GSP`, `MINI-ZB2GS`, `MINI-ZB2GS-L`,
`MINI-ZBDIM`, `MINI-ZBRBS`, `S60ZBTPF`, `temphumidutysensor2.js`, `ZBM5`) por
`writeAttributesVerbose(this, cluster, attrs)`. A partir de ahora, cualquier
escritura de atributo rechazada por el dispositivo aparecerá en los logs de
`homey app run` con el nombre del atributo y el motivo exacto — sin necesidad
de instrumentar nada manualmente cuando se sospeche un rechazo.

**Caso real ya documentado en el código** que se beneficiará de esto:
`ZBM5`'s `detach_relay_mode2` — el comentario en
`drivers/ZBM5/device.js` decía "Currently still failing with
MALFORMED_COMMAND on Homey" sin más detalle; la próxima vez que se pruebe,
el log dirá explícitamente qué atributo fue rechazado y con qué status,
confirmando (o descartando) que ese es realmente el problema.

**Actualización — también cubierto el helper compartido.** 20 drivers
(`MINI-ZB2GS*`, `MINI-ZBD`, `MINI-ZBRBS`, `SNZB-01M/03/03P/04/04P/05P/06P`,
`SWV`, `TRVZB`, `ZBM5`, `ZBMINIR2`, y los sensores de temp/humedad) no
llaman a `cluster.writeAttributes()` directamente, sino al helper compartido
`this.writeAttributes(cluster, attribs)` de `drivers/sonoffbase.js`
(`SonoffBase`, extendida por todos ellos). Ese helper tenía el mismo punto
ciego (`clust.writeAttributes(items).catch(...)`, **sin `await`** y sin
inspeccionar la respuesta). Se corrigió ahí mismo: ahora usa
`writeAttributesVerbose` internamente (con `await`, que además corrige que
antes la función no esperaba a que la escritura terminase). Con este único
cambio, los 20 drivers quedan cubiertos sin tocarlos uno a uno.

En total: **9 drivers** con `cluster.writeAttributes()` directo +
**`sonoffbase.js`** (que cubre otros 20) = prácticamente toda la superficie
de escritura de atributos de la app queda ahora diagnosticable.

---

## Historial de versiones de README.txt

`README.txt`/`README.es.txt` agrupan los dispositivos por la versión en la
que se añadieron (a petición del usuario, 2026-09-06). Fuentes usadas para
reconstruir esa cronología:

1. **Historial de commits/tags del repo público**
   (`https://github.com/StyraHem/Homey.Sonoff.Zigbee`, 107 commits, hasta que
   se archivó el código fuente el 2026-05-20) — cubre con precisión desde
   v1.0.9 hasta v1.7.0.
2. **Changelog oficial completo de la App Store de Homey** (pegado por el
   usuario en el chat, v1.0.0 → v1.15.0) — cubre el resto, incluyendo el
   hueco v1.7.0→v1.15.0 que el repo público no registraba (desarrollo movido
   a repo interno). Este texto no está guardado en ningún fichero del
   proyecto — si hace falta reconsultarlo, pedir al usuario que lo vuelva a
   pegar (viene de la página de la app en Homey App Store / developer
   dashboard) o buscar si Homey expone un endpoint de changelog por versión.

Con ambas fuentes combinadas, solo 4 drivers quedan sin versión exacta
conocida (llamada "Add X" nunca apareció en ningún changelog encontrado):
`SNZB-01`, `SNZB-01P`, `SNZB-02P`, `SNZB-02LD` (de este último sí se sabe que
existía ya antes de v1.7.3, por una mención indirecta en el changelog:
"remove humidity from 02LD").

v1.16.0 y v1.17.0 son de esta sesión (ver más abajo).

---

## Dónde conseguir los firmwares OTA

**https://github.com/Koenkk/zigbee-OTA/tree/master/images/Sonoff** — índice de
firmwares OTA que usa el propio zigbee2mqtt. Repositorio real y activo,
verificado el 2026-09-06 (26 ficheros en `images/Sonoff/`).

Cuando se quiera reactivar un bloque `firmwareUpdates` retirado (ver
`drivers/<ID>/firmwareUpdates.todo.json`): descargar el `.ota` de aquí,
colocarlo en `drivers/<ID>/assets/firmware/<nombre>.ota`, y **recalcular**
`size`/`integrity` (sha256) contra el fichero real descargado — no asumir que
el hash que ya estaba en el `.todo.json` sigue siendo válido si la versión
cambió (ver tabla de abajo).

Cruce contra lo que hay declarado en los `firmwareUpdates.todo.json` actuales
(comprobado el 2026-09-06):

| Driver(s) | Fichero esperado (`.todo.json`) | ¿Existe en zigbee-OTA? |
|---|---|---|
| MINI-ZB2GS, MINI-ZB2GS-L(-split) | `mini-zb2gs_v1.0.7.ota` | ✅ idéntico (297974 bytes) |
| SNZB-01M | `snzb-01m_v1.1.0.ota` | ✅ idéntico |
| SNZB-02D | `snzb-02d_v2.3.0.ota` | ✅ idéntico |
| SNZB-02DR2 | `snzb-02dr2_v1.0.4.ota` | ✅ idéntico |
| SNZB-02LD, SNZB-02WD | `snzb02lwd_v1.1.0.ota` | ✅ idéntico |
| SNZB-02P | `snzb-02p_v2.2.0.ota` | ✅ idéntico |
| SNZB-05P | `snzb-05p_v1.0.2.ota` | ✅ idéntico |
| SNZB-06P | `snzb-06p_v1.0.5.ota` | ✅ idéntico |
| SWV | `zbswv_v1.0.4.ota` | ✅ idéntico |
| TRVZB | `trvzb_v1.4.4.ota` | ✅ idéntico |
| ZBM5(+splits) | `zbm5-120-zed_v1.0.4.ota` / `zbm5-120-zr_v1.0.6.ota` | ✅ idénticos |
| ZBMICRO | `zbmicro_v1.0.5.ota` | ✅ idéntico |
| ZBMINIL2 | `zigbeeminil2_100E_stand_ota_file.ota` | ✅ idéntico |
| ZBMINIR2 | `zbminir2_v1.0.8.ota` | ✅ idéntico |
| **S60ZBTPF** | `SN-TLSR8656-S60-01-v2.0.2.ota` (v2.0.2) | ⚠️ el repo tiene **v2.0.3** — versión más nueva, el hash/tamaño del `.todo.json` ya no aplica, recalcular. |

Además, ya existe firmware para dos dispositivos que se tocaron/crearon esta
sesión y que **nunca tuvieron `firmwareUpdates` declarado** (ni bloqueaban
nada, así que no hay `.todo.json` para ellos, pero podría añadirse):
- `mini-zbdim_v1.0.5.ota` → **MINI-ZBDIM**
- `FWPLUG_MINIZB1GSP_ELECTRICAL_EFR32MG21_v1.1.2.ota` → **MINI-ZB1GSP**

Y firmware para los dos dispositivos aún no implementados en la app:
- `SN-MG21-MINIZB1GP-01_v1.2.7.ota` → MINI-ZB1GP
- `SN-TLSR8656-BASICZB1GSP-01-v1.0.5.ota` → BASIC-ZB1GSP

**Actualización 2026-09-06 (más tarde en la misma sesión): firmware YA
activado.** Se descargaron los 16 ficheros de la tabla de arriba, se verificó
cada uno contra el `sha512` publicado en `index.json` del propio repo
(`https://raw.githubusercontent.com/Koenkk/zigbee-OTA/master/index.json` —
manifiesto con `fileVersion`/`imageType`/`manufacturerCode`/`sha512`/`fileSize`
por fichero), se recalculó el `sha256` real (formato que exige `app.json`), y
se restauraron los 21 bloques `firmwareUpdates` (borrando los `.todo.json`
correspondientes). `S60ZBTPF` se reconstruyó con los datos de la versión
nueva (v2.0.3: `fileVersion:8195`, `size:147808`, sha256 recalculado) en vez
de reutilizar los del `.todo.json` (que eran de la v2.0.2, ya obsoleta).
Los `.ota` reales están ahora en `drivers/<ID>/assets/firmware/`.
`homey app validate`/`build` pasan con los 21 firmwares activos.

---

## Tipos ZCL construidos a mano

Ubicación: [`lib/SonoffCluster.js`](../lib/SonoffCluster.js), justo debajo del
`require` inicial (`ZCLRawCharStr`, `ZCLUint8Array`).

### Por qué existen

La librería `zigbee-clusters` (la de Homey, distinta de `zigbee-herdsman` que
usa zigbee2mqtt) escribe el **byte de tipo ZCL en la trama de escritura de
atributo** a partir de `attributeDef.type.id`
(`node_modules/zigbee-clusters/lib/zclFrames.js`, función `ZCLAttributeDataRecord`,
línea con `ZCLDataTypes.uint8.toBuffer(buf, attributes[v.id].type.id, i)`).

Esto significa que **el tipo que elijas para un atributo determina literalmente
el byte que el dispositivo real recibe indicando "esto que sigue es un X"** —
no es solo un detalle interno de JS, es protocolo real en el cable.

Dos atributos de Sonoff necesitan un byte de tipo específico pero **sin** el
formato de datos que ese tipo normalmente implica:

1. **`set_calibration_action`** (MINI-ZBDIM, id `0x001d`): zigbee-herdsman-converters
   lo declara `CHAR_STR` (id ZCL 66 / `0x42`), pero el valor que envía z2m es un
   **array de bytes crudo** (`[0x03,0x01,0x01,0x01]`), no un string. El propio
   código de `zigbee-herdsman` (`buffaloZcl.ts`, función `writeCharStr`) tiene
   una rama distinta para arrays que **se salta el byte de longitud** que sí
   escribe la rama de strings — hay un comentario del propio autor:
   `// XXX: value.length not written?`, reconociendo la asimetría/bug.
   - Wire real: `[0x42][0x03,0x01,0x01,0x01]` (5 bytes: 1 de tipo + 4 de payload,
     **sin** prefijo de longitud).
   - `ZCLDataTypes.string` de Homey SIEMPRE antepone un byte de longitud
     (no tiene la rama-array de zigbee-herdsman) → produciría
     `[0x42][0x04][0x03,0x01,0x01,0x01]`, incorrecto.
   - `ZCLDataTypes.buffer` de Homey tiene `id: NaN` → el byte de tipo escrito
     sería basura/NaN, rompiendo la trama igualmente (aunque el payload en sí
     sea correcto).
   - Por eso: `ZCLRawCharStr` — mismo `id` (66) que CHAR_STR, pero un
     `toBuffer` que copia los bytes tal cual, sin prefijo.

2. **`local_fast_scene_configuration`** (MINI-ZB1GSP "Power Protector", id `0x7016`):
   zigbee-herdsman-converters lo escribe como tipo ZCL `ARRAY` (id 72 / `0x48`)
   con `elementType: UINT8`. El formato real de un `ARRAY` en la especificación
   ZCL es `[elementType:1 byte][count:2 bytes LE][elementos...]`.
   - `ZCLUint8Array` reproduce exactamente ese formato: `id: 72` (para que el
     byte de tipo sea correcto) y un `toBuffer` que escribe
     `0x20` (uint8) + count LE + los bytes.

### Cómo verificar si algo va mal

Si un dispositivo real rechaza estas escrituras (`MALFORMED_COMMAND`,
`INVALID_DATA_TYPE`, o simplemente no aplica el cambio):

```js
node -e "
const SonoffCluster = require('./lib/SonoffCluster.js');
const { Cluster } = require('zigbee-clusters');
Cluster.addCluster(SonoffCluster);
const attr = SonoffCluster.attributes.set_calibration_action; // o local_fast_scene_configuration
const buf = Buffer.alloc(64);
const n = attr.type.toBuffer(buf, /* valor de prueba */ Buffer.from([0x03,0x01,0x01,0x01]), 0);
console.log(buf.slice(0, n).toString('hex'));
"
```

Compara el hex resultante contra lo que `zigbee-herdsman-converters` produce
para el mismo dispositivo (buscar el `toZigbee`/`convertSet` correspondiente en
`https://github.com/Koenkk/zigbee-herdsman-converters/blob/master/src/devices/sonoff.ts`).
Si no coincide byte a byte, el bug está en el `toBuffer` de nuestro tipo, no en
el dispositivo.

`SonoffCluster.createPowerProtectorPayload()` / `.parsePowerProtectorPayload()`
son la codificación/decodificación completa del "Power Protector" — replican
byte a byte el `toZigbee.convertSet` / `fromZigbee.convert` de
`localFastSceneConfiguration({hasSwitch:true})` en zigbee-herdsman-converters.
Verificado con un test aislado (round-trip encode→decode) antes de darlo por
bueno, pero **nunca probado contra hardware real** — si falla, lo primero es
comparar el hex generado contra el que produciría z2m con los mismos valores.

`SonoffCluster.createInchingPayload()` es el mecanismo de "inching" (encendido/
apagado retardado tras pulsar), payload de 11 bytes, ya verificado
byte-a-byte contra el mismo fichero fuente. El límite de UI se dejó en 3599.5s
en todos los drivers aunque algunos modelos anuncian hasta 86399.5s en z2m —
el campo de tiempo en el payload real es de 16 bits (máx. ~32767.5s), así que
z2m mismo desbordaría si alguien pusiera su propio máximo anunciado. Se prefirió
el límite seguro.

---

## Sesión 2026-09-06 — dispositivos añadidos/modificados

Punto de partida: v1.15.0 (34 drivers). Fin de sesión: **v1.16.0 (38 drivers)**.
Fuentes usadas para verificar/portar: `zigbee-herdsman-converters` (definiciones
de dispositivo) y `zigbee-herdsman` (codificación ZCL real) — las mismas que usa
zigbee2mqtt internamente.

### Añadidos (nuevos drivers)

| Driver | Origen | Notas |
|---|---|---|
| `MINI-ZBDIM` | Portado desde `Homey.Sonoff.Zigbee.older` | Ver correcciones más abajo |
| `ZBMINI` | Portado desde `Homey.Sonoff.Zigbee.older` | `productId: 01MINIZB`, primera generación del switch mini |
| `MINI-ZB1GS` | Construido desde cero (no existía driver previo) | Verificado 100% contra zigbee-herdsman-converters |
| `MINI-ZB1GSP` | Construido desde cero | = MINI-ZB1GS + medición de energía + Power Protector |

Todos validan (`homey app validate` nivel `publish`) y compilan
(`homey app build`).

### `MINI-ZBD`: driver propio (no alias)

Primer intento: alias de `productId` dentro de `ZBMINIR2` (mismo firmware,
según `whiteLabel` en zigbee-herdsman-converters). El usuario aclaró que,
aunque comparten firmware/exposes idénticos, son SKUs físicamente distintos
(`ZBMINIR2` tiene botón físico; `MINI-ZBD` es un relé de contacto seco sin
botón, para instalar embebido). Se revirtió el alias y se creó
`drivers/MINI-ZBD/` como driver independiente: mismo `device.js` que
`ZBMINIR2` (clase `SonoffBase`, mismos atributos), pero con su propio nombre,
imagen (provisional, ver más abajo) e instrucciones de emparejamiento propias
(sin botón físico — se empareja alternando 10 veces el interruptor externo
conectado, igual que el método alternativo que ya documenta la página de z2m
de `ZBMINIR2`). Mismo firmware `.ota` que `ZBMINIR2`
(`zbminir2_v1.0.8.ota`), declarado bajo el `productId` propio de `MINI-ZBD`.

### Correcciones sobre drivers ya existentes

- **`S60ZBTPF`**: `measure_power`/`measure_voltage`/`measure_current` leían del
  cluster estándar Electrical Measurement (`0x0B04`) — el dispositivo real
  expone esos valores por el cluster propietario Sonoff (`0xFC11`,
  `acCurrentPowerValue`/`acCurrentVoltageValue`/`acCurrentCurrentValue`).
  Probablemente daban 0 siempre en producción. Corregido. Añadidos también
  `network_indicator` y `outlet_control_protect` (existían en el cluster pero
  sin ajuste conectado).
- **`MINI-ZBDIM`** (recién portado, mismo bug detectado antes de publicar):
  mismo fix de cluster de medición. Añadido "Delayed power-on" (no existía) y
  "Start calibration" (maintenance action + 3 atributos de estado/progreso).

### Firmware OTA retirado (no relacionado con lo anterior, pero mismo hilo)

15 drivers tenían un bloque `firmwareUpdates` en `app.json` apuntando a `.ota`
inexistentes en el repo — bloqueaba `homey app validate` incluso a nivel
`debug`. Se movió cada bloque a un `firmwareUpdates.todo.json` junto al driver
correspondiente (con instrucciones de cómo reactivarlo cuando exista el
binario real), y se retiró de `app.json`.

### Gaps conocidos, no implementados (decisión pendiente del usuario)

- **`S60ZBTPF`**: protección por sobrecarga (atributos `0x7000`-`0x7008`
  declarados en `SonoffCluster.js` pero **nunca verificados** contra
  zigbee-herdsman-converters — a diferencia de `MINI-ZB1GSP`, para este modelo
  la protección se implementa como 9 atributos ZCL simples, no como el buffer
  empaquetado de `localFastSceneConfiguration`. No tocado.
- **`BASIC-ZB1GSP`** (DIN rail + medición + historial de consumo) y
  **`MINI-ZB1GP`** (medidor sin interruptor): no existen en la app. Detectados
  al comparar contra el catálogo Zigbee de sonoff.tech. No iniciados.

### Assets provisionales pendientes de sustituir

- `drivers/MINI-ZB1GSP/assets/` usa temporalmente las imágenes de `MINI-ZB1GS`
  (no hay fotos reales del `MINI-ZB1GSP` todavía).
- `drivers/MINI-ZBD/assets/` usa temporalmente las imágenes de `ZBMINIR2`
  (mismo icono genérico, pero la foto de producto real de `MINI-ZBD` es
  distinta — es un módulo sin botón, para contacto seco).
- `MINI-ZB1GS` sí tiene fotos reales de producto (proporcionadas por el
  usuario, redimensionadas a 500×500/75×75 con `sharp-cli`).
- El `icon.svg`/`learn.svg` de todos los "mini" nuevos reutiliza el genérico
  de `ZBMINIR2` — confirmado por el usuario que es intencionado (mismo icono
  para cualquier módulo mini).

### Versión

`app.json` → `1.17.1` (era `1.15.0`; `1.16.0` = drivers nuevos + fixes,
`1.16.1` = alias `MINI-ZBD` [luego revertido], `1.17.0` = firmware OTA
restaurado en 21 drivers + `MINI-ZBD` como driver propio, `1.17.1` =
diagnóstico de escrituras de atributos rechazadas). Entrada de changelog en
`.homeychangelog.json`. Sin commit de git (el proyecto no es un repositorio
git), así que el rollback es manual: para volver atrás, restaurar `app.json`,
`lib/SonoffCluster.js` y borrar las carpetas
`drivers/{MINI-ZBDIM,ZBMINI,MINI-ZB1GS,MINI-ZB1GSP}` — no hay otro mecanismo
de versionado disponible en este entorno.

---

## Sesión 2026-09-07 — SNZB-01M no reportaba pulsaciones

**Síntoma:** el usuario emparejó el `SNZB-01M` (botón de 4 escenas), el
dispositivo aparecía como emparejado y con batería correcta, pero ninguna
pulsación llegaba nunca a Homey — ni siquiera a nivel de frame en bruto
(se instrumentó temporalmente `zclNode.handleFrame` para volcar cada frame
recibido en hexadecimal antes de cualquier parseo, y no llegó ninguno).

**Descartado durante la investigación (el driver estaba bien):**
- El cluster propio `0xFC12` (`SonoffCluster2`, ver [lib/SonoffCluster2.js](../lib/SonoffCluster2.js)),
  el atributo `keyActionEvent` (id `0x0000`, `uint8`) y el mapeo de valores
  (1=single, 2=double, 3=long, 4=triple) se contrastaron contra el PR real que
  añadió soporte para este modelo en `zigbee-herdsman-converters`
  (Koenkk/zigbee-herdsman-converters#10563) y coinciden exactamente. Ese PR
  tampoco hace `bind`/`configureReporting` para este cluster — el dispositivo
  manda los reportes sin que se le pida.
- Se desplegó también el `app.json`/código **originales** (copia de respaldo
  en `C:\Developer\Homey.Sonoff.Zigbee.original`, v1.15.0, sin ningún cambio
  de esta sesión) y el resultado fue idéntico: silencio total. Confirma que
  nunca fue una regresión de código, en ninguna versión.

**Hallazgo real:** con el mismo mecanismo de "vuelca cada frame" pero
aplicado de forma genérica (no solo al cluster esperado), se descubrió que el
dispositivo emparejado **sí hablaba con Homey**, pero en bucle: mandaba un
comando `groups.addGroup` (unirse al grupo Zigbee 1) **una vez por segundo,
sin parar**, en vez de sus reportes normales de `keyActionEvent`. Eso no es
comportamiento normal para un dispositivo de pila (la vaciaría en días) — es
el patrón de un dispositivo atascado en una fase de comisionado/vinculación a
grupo que nunca se da por completada.

**Solución:** reset de fábrica real del dispositivo (mantener botón ~10s
hasta parpadeo rápido del LED, **no** solo el gesto de emparejamiento de 5s)
+ eliminarlo y volver a emparejarlo desde cero, pegado al Homey. Tras eso,
las pulsaciones de los 4 botones se reportaron correctamente al instante
(`SonoffCluster2.reportAttributes` → `Button N action {single,double,...}`).
El código de `drivers/SNZB-01M/device.js` no necesitó ningún cambio final —
la causa era el estado interno del propio dispositivo, no la app.

**Efecto secundario descubierto y arreglado — ruido de "remote control":**
Este modelo también actúa como mando a distancia (puede controlar otros
dispositivos/grupos directamente, función documentada en su ficha de
zigbee2mqtt). Además del bucle de `addGroup` ya descrito, manda comandos
`identify` y `onOff` (encender/apagar/toggle) a sus 4 endpoints como parte de
esa función. Como ningún driver de esta app implementa esos clusters, cada
comando se registraba como error `binding_unavailable`, repetidamente, en el
log — ruido inofensivo pero constante.

Arreglado en [drivers/sonoffbase.js](../drivers/sonoffbase.js)
(`SonoffBase.onNodeInit`, clase `SilentNoOpBoundCluster`): se vincula un
`BoundCluster` que sobreescribe `handleFrame()` para no hacer nada (ni
lanzar, ni fabricar una respuesta funcional falsa) a `groups`/`identify`/
`onOff` en todos los endpoints existentes de cada dispositivo, si no había ya
otro binding para ese cluster. Mismo criterio que zigbee2mqtt: cuando no hay
manejador real para un comando entrante, se ignora silenciosamente (ver su
log: `No converter available for 'SNZB-01P' with cluster 'genIdentify' and
type 'commandIdentifyQuery'`) — no se intenta simular la función de mando.
Al ser un fix en la base compartida, aplica a todos los drivers que extienden
`SonoffBase`, no solo a `SNZB-01M`.

De paso, en esta misma versión (`1.16.0`) se eliminó también el bloque
`energy` redundante de `S60ZBTPF` (`cumulative`/`cumulativeImportedCapability`
sin su pareja `cumulativeExportedCapability`) que generaba un warning en
`homey app validate` — ver comentario del commit en `.homeychangelog.json`.
`meter_power` ya es acumulativo por definición en Homey, así que ese bloque
no aportaba nada para un enchufe que solo mide consumo (no exporta energía).

**Otro gap detectado de paso (no relacionado con el síntoma, no explotado):**
el `pollControl` (cluster 32) integrado en `zigbee-clusters` tiene
`COMMANDS: {}` — no implementa el comando `checkIn` que mandan los
dispositivos "sleepy" para negociar con su coordinador. Si un dispositivo
Sonoff/eWeLink llega a depender de recibir un `checkInResponse` real (se vio
necesario para el `SNZB-01P` en `C:\Developer\homey-sonoff-snzba01p`, otro
proyecto del usuario), este driver base **no** lo contesta — solo pasa por
la "default response" ZCL genérica. No se ha aplicado ningún fix para esto en
`SNZB-01M` porque no era la causa del problema (el dispositivo nunca llegó a
mandar `checkIn` en las pruebas), pero queda anotado por si aparece en otro
dispositivo sleepy de esta app.

---

## Sesión 2026-09-08 — SNZB-09P (sirena) añadido

Nuevo driver, añadido **sin hardware real para probar** — implementado a
partir de la documentación de
[zigbee2mqtt](https://www.zigbee2mqtt.io/devices/SNZB-09P.html) y del PR real
que le dio soporte en zigbee-herdsman-converters
([Koenkk/zigbee-herdsman-converters#12337](https://github.com/Koenkk/zigbee-herdsman-converters/pull/12337)).
Antes de dar por bueno el emparejamiento con un dispositivo físico, revisar
los puntos marcados como asunción a continuación.

**Cluster:** reutiliza `customClusterEwelink` = `0xFC11` (64529), el mismo
cluster que ya teníamos como `lib/SonoffCluster.js` (compartido con
MINI-ZBDIM, MINI-ZB1GSP, S60ZBTPF, etc.). Se añadieron sus atributos y
comando propios a ese fichero compartido, no un cluster nuevo:

- `power_supply_mode` (`0x0024`, uint8): 0=batería, 1=externa. Solo lectura,
  no expuesto como capability (informativo).
- `alarm_sound_enable` (`0x2026`, bool), `alarm_light_enable` (`0x2022`,
  bool), `alarm_sound_type` (`0x2023`, uint8, 0-9), `alarm_volume_level`
  (`0x2024`, uint8: 0=low/1=medium/2=high/3=highest), `alarm_duration`
  (`0x2025`, uint16, segundos 1-900): configuración de la sirena, expuesta
  como **settings** del driver (no capabilities) — se leen en el momento de
  activar la sirena, no se empujan al dispositivo de forma proactiva.
- `tamper` (`0x2000`, uint8): **reutiliza el atributo `tamper` que ya
  existía** en `SonoffCluster.js` (mismo id, ya usado por `SNZB-04P`) — en
  la documentación de z2m aparece como `spilt`, pero es el mismo id/tipo.

**Comando `alertCommand` (`0x0f`, manufacturer-specific):** no es un simple
atributo — es un comando con un buffer de bytes crudos, **bidireccional**:
- Para activar: `[0x02, 0x00, voice, light, alertSound, volume,
  durationLow, durationHigh, 0x00]` (`SonoffCluster.createAlertPayload()`).
- Para cancelar: `[0x01]` (`SonoffCluster.createCancelAlertPayload()`).
- El dispositivo **también manda el mismo comando hacia nosotros** cuando el
  estado cambia (activado a mano, por escena, o cancelado) — `data[1]` = 0
  (ninguno), 1 (manual) o 2 (escena). Por eso `device.js` registra un
  `BoundCluster` (`SirenAlertBoundCluster`) con un método `alertCommand()`,
  igual que `PushButtonBoundCluster` en `drivers/SNZB-01/device.js` hace con
  `onOff` — mismo patrón, comando distinto.

**Capabilities:** `onoff` (activa/cancela la sirena), `alarm_tamper`
(estándar de Homey), `measure_battery` (vía `powerConfiguration`, igual que
el resto de sensores de esta app — sin necesidad de nada especial).

**Asunciones sin verificar contra hardware real (revisar en el primer
emparejamiento):**
- `manufacturerName`: el PR de zigbee-herdsman-converters no incluye un
  `fingerprint` explícito con manufacturerName para este dispositivo (usa
  fallback genérico). Puse `["SONOFF", "eWeLink"]` en
  `driver.compose.json` cubriendo ambas variantes que usan otros drivers de
  esta app (`SNZB-02DR2` usa `SONOFF`, `SNZB-04P` usa `eWeLink`), pero no
  está confirmado cuál usa el `SNZB-09P` real.
- Lista de `clusters`/`endpoints` (`0, 1, 3, 64529` en endpoint 1): inferida
  por analogía con `SNZB-04P` (sensor de batería con el mismo cluster
  propietario), no hay log de interview real de este modelo.
- **Assets**: `large.png`/`small.png` ya son fotos reales del producto
  (aportadas por el usuario, 500×500/75×75 — tamaño correcto sin necesidad
  de redimensionar). `icon.svg`/`learn.svg` siguen siendo la copia
  provisional de `SNZB-06P` (silueta vectorial, no hay una real todavía).

**Versión:** `1.16.1` — entrada añadida en `.homeychangelog.json` y README
(en/es), siguiendo la convención de minor bump para dispositivo nuevo. Ojo:
el `version` real vive en `.homeycompose/app.json` (Homey Compose regenera
`app.json` a partir de ahí en cada `validate`/`run` — editar `app.json`
directamente no persiste).
