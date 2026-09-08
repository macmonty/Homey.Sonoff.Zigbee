Sonoff Zigbee

La aplicación Homey agregará soporte para dispositivos Sonoff.

Dispositivos de soporte (agrupados por la versión en la que se añadió cada uno):

--- v1.0.9 ---
-Sonoff SNZB-02   (Termómetro cuadrado)
-Sonoff SNZB-02D  (Termómetro con pantalla)

--- v1.0.12 ---
-Sonoff SNZB-04   (Contacto puerta/ventana)

--- v1.0.14 ---
-Sonoff SNZB-03   (Detector de movimiento)
-Sonoff SNZB-06P  (Detector de presencia)

--- v1.2.0 ---
-Sonoff ZBMINI-L  (Interruptor)
-Sonoff ZBMINI-L2 (Interruptor)
-Dispositivos Sonoff RF/TX (envío y recepción)

--- v1.4.0 ---
-Sonoff ZBTRV     (Válvula de radiador)
-Sonoff SNZB-03P  (Detector de movimiento)
-Sonoff SNZB-04P  (Contacto puerta/ventana)

--- v1.5.0 ---
-Sonoff ZBCurtain (Cortina)

--- v1.6.2 ---
-Sonoff SNZB-05P  (Sensor de fugas de agua)

--- v1.7.0 ---
-Sonoff ZBMINIR2  (Interruptor con botón externo)

--- v1.7.1 ---
-Sonoff SWV       (Válvula de agua)

--- v1.7.2 ---
-Sonoff ZBMicro   (Interruptor USB)

--- v1.7.3 ---
-Sonoff SNZB-02WD (Termómetro para exteriores)

--- v1.7.9 ---
-Sonoff S60ZBTPF  (Enchufe con medición de potencia)

--- v1.9.0 ---
-Sonoff SNZB-02DR2 (Termómetro con pantalla)

--- v1.10.0 ---
-Sonoff SNZB-01M  (Botón 4 en 1)

--- v1.12.0 ---
-Sonoff DUO       (Interruptor 2 canales, requiere neutro)
-Sonoff DUO-L     (Interruptor 2 canales, sin neutro)

--- v1.13.0 ---
-Sonoff BASICZBR3 (Interruptor inteligente)
-Sonoff MINI-ZBRBS (Interruptor de persiana)

--- v1.14.0 ---
-Sonoff DUO — controlador de canales separados

--- v1.15.0 ---
-Sonoff DUO-L — controlador de canales separados
-Sonoff ZBM5      (Interruptor de pared, 1/2/3 canales — controladores de canal separado añadidos)

--- Versión exacta sin registrar ---
-Sonoff SNZB-01   (Botón cuadrado)
-Sonoff SNZB-01P  (Botón redondo)
-Sonoff SNZB-02P  (Termómetro redondo)
-Sonoff SNZB-02LD (Termómetro de exterior con sonda — existía antes de v1.7.3)

--- v1.15.1 ---
-Sonoff MINI-ZBDIM (Atenuador inteligente)
-Sonoff ZBMINI    (Interruptor)
-Sonoff MINI-ZB1GS (Interruptor inteligente)
-Sonoff MINI-ZB1GSP (Interruptor inteligente con medición de energía)
-Sonoff MINI-ZBD  (Interruptor de contacto seco)

--- v1.16.1 ---
-Sonoff SNZB-09P  (Sirena)

Changelog (correcciones, no dispositivos nuevos)
--------------------------------------------------

--- v1.15.1 ---
-Añadidos MINI-ZBDIM, ZBMINI, MINI-ZB1GS y MINI-ZB1GSP. Corregida la lectura de potencia/voltaje/corriente en S60ZBTPF y MINI-ZBDIM (cluster incorrecto). Añadido soporte de calibración, encendido retardado y protector de energía donde aplica. ZBMINIR2 ahora también reconoce MINI-ZBD (misma placa, versión de contacto seco). Restaurado el firmware OTA real en 21 drivers.

--- v1.15.2 ---
-Los rechazos de escritura de atributos Zigbee (p.ej. MALFORMED_COMMAND, UNSUPPORTED_ATTRIBUTE) ahora quedan registrados con el nombre exacto del atributo y el motivo, en vez de silenciarse.

--- v1.16.0 ---
-Silenciados errores de log inofensivos pero repetitivos, causados por botones de escena Sonoff (p.ej. SNZB-01M) al usar su función de mando a distancia (comandos de grupo/identify/on-off hacia otros dispositivos), que ningún driver gestionaba. Eliminado un aviso de validación en S60ZBTPF causado por un ajuste de energía redundante (solo mide consumo, no exportación).

--- v1.16.1 ---
-Añadido soporte para SNZB-09P (sirena): activar/cancelar mediante on/off, preajustes de sonido/luz/volumen/duración como ajustes, alarma de manipulación y batería. Implementado a partir de documentación, todavía sin verificar contra un dispositivo real.
