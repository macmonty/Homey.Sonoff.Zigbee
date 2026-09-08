const { Cluster, ZCLDataTypes, ZCLDataType } = require("zigbee-clusters");

// zigbee-clusters writes an attribute's wire type-tag byte from `type.id`
// (see zigbee-clusters/lib/zclFrames.js ZCLAttributeDataRecord). Both
// ZCLDataTypes.buffer and .string are unsuitable for a couple of Sonoff
// attributes that need raw, unframed bytes behind a *specific* ZCL type tag:
// buffer's `.id` is NaN (would corrupt the wire type byte) and string's
// toBuffer always prepends a length byte (which these attributes must NOT
// have — confirmed against zigbee-herdsman's writeCharStr(), whose "array"
// input branch skips the length prefix that its "string" branch writes).
//
// Raw octets tagged as ZCL CHAR_STR (id 66), no length prefix — matches
// zigbee-herdsman-converters passing a plain byte array (not a string) for
// SonoffCluster.set_calibration_action.
const ZCLRawCharStr = new ZCLDataType(
    66, 'rawCharStr', -0,
    (buf, v, i) => {
        const b = Buffer.isBuffer(v) ? v : Buffer.from(v);
        b.copy(buf, i);
        return b.length;
    },
    (buf, i) => buf.slice(i),
);

// Raw ZCL ARRAY of UINT8 (type tag 0x48, elementType 0x20, 2-byte LE count,
// then the raw elements) — matches zigbee-herdsman-converters writing
// SonoffCluster.local_fast_scene_configuration as
// `{elementType: UINT8, elements: bytes}` with `type: ARRAY`.
const ZCLUint8Array = new ZCLDataType(
    72, 'rawUint8Array', -0,
    (buf, v, i) => {
        const elements = Buffer.isBuffer(v) ? v : Buffer.from(v);
        let offset = buf.writeUInt8(0x20, i);
        offset = buf.writeUInt16LE(elements.length, offset);
        elements.copy(buf, offset);
        return (offset + elements.length) - i;
    },
    (buf, i) => buf.slice(i),
);

class SonoffCluster extends Cluster {

    static get ID() {
        return 64529; //Hex: 0Xfc11
    }

    static get NAME() {
        return 'SonoffCluster';
    }

    static get COMMANDS() {
        return {
            setInching: {
                id: 0x01,
                manufacturerSpecificCommand: true,
                args: {
                    data: ZCLDataTypes.buffer
                }
            },
            // SNZB-09P siren activate/cancel. Byte-for-byte match of
            // zigbee-herdsman-converters' 'alertCommand' (id 0x0f), see
            // createAlertPayload()/createCancelAlertPayload() below.
            alertCommand: {
                id: 0x0f,
                manufacturerSpecificCommand: true,
                args: {
                    data: ZCLDataTypes.buffer
                }
            }
        };
    }

    // SNZB-09P: activate the siren using the device's currently configured
    // sound/light/volume/duration attributes. Byte-for-byte match of
    // zigbee-herdsman-converters' snzb_09p_alert toZigbee (siren_on: 'ON').
    static createAlertPayload({ soundEnable, lightEnable, soundType, volumeLevel, durationSeconds }) {
        const duration = Math.max(1, Math.min(900, Math.round(durationSeconds)));
        return Buffer.from([
            0x02,                 // command: start alert
            0x00,
            soundEnable ? 1 : 0,  // voice
            lightEnable ? 1 : 0,  // light
            soundType & 0xFF,     // alertSound (0-9 preset)
            volumeLevel & 0xFF,   // volume (0-3)
            duration & 0xFF,          // duration low byte
            (duration >> 8) & 0xFF,   // duration high byte
            0x00
        ]);
    }

    // SNZB-09P: cancel an active siren alert.
    static createCancelAlertPayload() {
        return Buffer.from([0x01]);
    }

    // Helper method to create inching control payload
    // Based on zigbee-herdsman-converters implementation
    static createInchingPayload(enabled, mode, timeSeconds) {
        // Payload format (11 bytes):
        // [0] = 0x01 (Cmd)
        // [1] = 0x17 (SubCmd)
        // [2] = 0x07 (Length)
        // [3] = 0x80 (SeqNum)
        // [4] = mode flags (bit 7 = enabled, bit 0 = mode)
        // [5] = channel (0x00 for channel 1)
        // [6-7] = time in 0.5 second units (16-bit, low byte first)
        // [8-9] = 0x00 (reserved)
        // [10] = checkCode (XOR of bytes 0-9)

        const timeUnits = Math.round(timeSeconds * 2);
        // bit 7 (0x80) = enabled, bit 0 (0x01) = mode (on after off)
        const modeFlags = (enabled ? 0x80 : 0x00) | (mode === 'on' ? 0x01 : 0x00);

        const payload = [
            0x01,                      // Cmd
            0x17,                      // SubCmd
            0x07,                      // Length
            0x80,                      // SeqNum
            modeFlags,                 // Mode flags
            0x00,                      // Channel (0 = channel 1)
            timeUnits & 0xFF,          // Time low byte
            (timeUnits >> 8) & 0xFF,   // Time high byte
            0x00,                      // Reserved
            0x00                       // Reserved
        ];

        // Calculate XOR checksum
        let checkCode = 0;
        for (let i = 0; i < payload.length; i++) {
            checkCode ^= payload[i];
        }
        payload.push(checkCode);

        return Buffer.from(payload);
    }

    // MINI-ZB1GSP "Power Protector" (localFastSceneConfiguration) payload.
    // Byte-for-byte match of zigbee-herdsman-converters' encoder — see its
    // localFastSceneConfiguration({hasSwitch:true}) toZigbee.convertSet.
    // Settings units: current in A, power in W, voltage in V, all stored
    // on the wire as value*1000 (uint32).
    static createPowerProtectorPayload(settings) {
        const toUInt32LEBytes = (value) => {
            const v = value >>> 0;
            return [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];
        };

        const sceneValue = [1]; // enabled
        sceneValue.push(...toUInt32LEBytes(Math.round(settings.maxCurrentProtect * 1000)));
        sceneValue.push(...toUInt32LEBytes(Math.round(settings.maxPowerProtect * 1000)));
        sceneValue.push(settings.externalSwitchOnlyRecovery ? 1 : 0);

        const maxVoltage = Math.round(settings.maxVoltageProtect * 1000) & 0x7fffffff;
        const minVoltage = Math.round(settings.minVoltageProtect * 1000) & 0x7fffffff;
        sceneValue.push(...toUInt32LEBytes((settings.maxVoltageProtectEnabled ? 0x80000000 : 0) | maxVoltage));
        sceneValue.push(...toUInt32LEBytes((settings.minVoltageProtectEnabled ? 0x80000000 : 0) | minVoltage));
        sceneValue.push(settings.autoRecovery ? 1 : 0, 1);

        const powerProtectorType = 0x02;
        return Buffer.from([0x00, 0x01, 0x01, powerProtectorType, sceneValue.length & 0xff, ...sceneValue]);
    }

    // Decodes a reported localFastSceneConfiguration buffer back into the
    // same field names createPowerProtectorPayload() accepts. Returns null
    // if the buffer doesn't contain a "power protector" (type 0x02) scene.
    static parsePowerProtectorPayload(bytes) {
        if (!bytes || bytes.length < 5) return null;
        const powerProtectorType = 0x02;

        let index = 3;
        while (index + 1 < bytes.length) {
            const reportedSceneType = bytes[index];
            const length = bytes[index + 1];
            index += 2;
            const value = bytes.slice(index, index + length);
            index += length;

            if (reportedSceneType !== powerProtectorType) continue;
            if (value.length < 19) return null;

            const readUInt32LE = (buf, i) => buf[i] + buf[i + 1] * 0x100 + buf[i + 2] * 0x10000 + buf[i + 3] * 0x1000000;
            const maxVoltageRaw = readUInt32LE(value, 10);
            const minVoltageRaw = readUInt32LE(value, 14);

            return {
                maxCurrentProtect: readUInt32LE(value, 1) / 1000,
                maxPowerProtect: readUInt32LE(value, 5) / 1000,
                externalSwitchOnlyRecovery: value[9] === 1,
                maxVoltageProtectEnabled: !!(maxVoltageRaw & 0x80000000),
                maxVoltageProtect: (maxVoltageRaw & 0x7fffffff) / 1000,
                minVoltageProtectEnabled: !!(minVoltageRaw & 0x80000000),
                minVoltageProtect: (minVoltageRaw & 0x7fffffff) / 1000,
                autoRecovery: value[18] === 1,
            };
        }
        return null;
    }

    static get ATTRIBUTES() {
        return {
            child_lock: {
                id: 0x0000,
                type: ZCLDataTypes.bool
            },
            network_led: {
                id: 0x0001,
                type: ZCLDataTypes.bool
            },
            back_light: {
                id: 0x0002,
                type: ZCLDataTypes.bool
            },
            // MINI-ZB1GS overheat alarm. TLV-encoded: byte3=type (must be
            // 0x07), byte2=length (must be 0x02), lower 16 bits = fault
            // bitfield (bit0 = device_overheated). Confirmed against
            // zigbee-herdsman-converters' faultCodeMiniZb1gs().
            fault_code: {
                id: 0x0010,
                type: ZCLDataTypes.uint32
            },
            turbo_mode: {
                id: 0x0012,
                type: ZCLDataTypes.int16
                //9 Off, 20 On
            },        
            power_on_delay_state: {
                id: 0x0014,
                type: ZCLDataTypes.bool        
            },
            power_on_delay_time: {
                id: 0x0015,
                type: ZCLDataTypes.uint16
            },
            switch_mode: {
                id: 0x0016,
                type: ZCLDataTypes.uint8
                // type: ZCLDataTypes.enum8({
                //   edge: 0x00,
                //   pulse: 0x01,
                //   follow_on: 0x02,
                //   follow_off: 0x82,
                // })
            },
            detach_mode: {
                id: 0x0017,
                type: ZCLDataTypes.bool
            },
            device_work_mode: {
                id: 0x0018,
                type: ZCLDataTypes.uint8
                // 0 = Zigbee End device, 1 = Zigbee Router
            },
            transition_time: {
                id: 0x001f,
                type: ZCLDataTypes.uint32
                // Device-side transition time in 0.1s increments (e.g. MINI-ZBDIM)
            },
            // MINI-ZBDIM dimmer auto-calibration (matches its lamp's real
            // dimming range). set_calibration_action is write-only and typed
            // CHAR_STR by zigbee-herdsman-converters, but z2m always sends a
            // raw byte ARRAY (never a JS string) for this attribute — and
            // zigbee-herdsman's own writeCharStr() has a known quirk (see its
            // "XXX: value.length not written?" comment) where the array
            // branch skips the length-prefix byte that the string branch
            // writes. So the real wire payload is the CHAR_STR type tag (66)
            // followed by the raw bytes with NO length prefix — see
            // ZCLRawCharStr above; do not use ZCLDataTypes.string (always
            // prepends a length byte) or ZCLDataTypes.buffer (its `.id` is
            // NaN, which corrupts the wire type-tag byte for an attribute).
            set_calibration_action: {
                id: 0x001d,
                type: ZCLRawCharStr
            },
            calibration_status: {
                id: 0x001e,
                type: ZCLDataTypes.uint8
                // 0=uncalibrated, 1=calibrating, 2=calibration_failed, 3=calibrated
            },
            calibration_progress: {
                id: 0x0020,
                type: ZCLDataTypes.uint8
                // Percent complete (0-100) while calibration_status === calibrating
            },
            level_for_calibration: {
                id: 0x4006,
                type: ZCLDataTypes.uint8
            },
            min_brightness_threshold: {
                id: 0x4001,
                type: ZCLDataTypes.uint8
                // Lowest brightness (0-255) mapped to 1% on the Homey slider
            },
            max_brightness_threshold: {
                id: 0x4002,
                type: ZCLDataTypes.uint8
                // Highest brightness (0-255) mapped to 100% on the Homey slider
            },
            dimming_light_rate: {
                id: 0x4003,
                type: ZCLDataTypes.uint8
                // Speed of brightness change via the physical switch (1-5)
            },
            detach_relay_mode2: {
                id: 0x0019,
                // BITMAP8. zigbee2mqtt sends this WITHOUT manufacturer-specific
                // framing (no manufacturerCode in the write options) and the
                // device accepts it — adding manufacturerId here actually
                // causes ZBM5 to reject the write with MALFORMED_COMMAND.
                // bit 0 = relay 1 detached, bit 1 = relay 2 detached, bit 2 = relay 3 detached.
                type: ZCLDataTypes.map8('l1', 'l2', 'l3', '_b3', '_b4', '_b5', '_b6', '_b7')
            },
            // MINI-ZB1GS physical button action feed (read-only report).
            // 1=single_click, 2=double_click, 3=long_press, 4=switch_on, 5=switch_off.
            detach_relay_action_event: {
                id: 0x0028,
                type: ZCLDataTypes.uint8
            },
            motor_travel_calibration_action: {
                id: 0x5001,
                type: ZCLDataTypes.uint8
                // 2=start_automatic, 3=start_manual, 4=clear,
                // 7=manual_2_fully_opened, 8=manual_3_fully_closed
            },
            tamper: {
                id: 0x2000,
                type: ZCLDataTypes.uint8
            },
            illuminance: {
                id: 0x2001,
                type: ZCLDataTypes.uint8
            },
            temperature_offset: {
                id: 0x2003,
                type: ZCLDataTypes.int16
            },
            humidity_offset: {
                id: 0x2004,
                type: ZCLDataTypes.int16
            },            
            comfort_temperature_max: {
                id: 0x0003,
                type: ZCLDataTypes.int16
            },
            comfort_temperature_min: {
                id: 0x0004,
                type: ZCLDataTypes.int16
            },
            comfort_humidity_min: {
                id: 0x0005,
                type: ZCLDataTypes.uint16
            },
            comfort_humidity_max: {
                id: 0x0006,
                type: ZCLDataTypes.uint16
            },
            temperature_unit: {
                id: 0x0007,
                type: ZCLDataTypes.uint16
            },
            open_window: {
                id: 0x6000,
                type: ZCLDataTypes.bool
            },
            frost_protection_temperature: {
                id: 0x6002,
                type: ZCLDataTypes.int16
            },
            idle_steps: {
                id: 0x6003,
                type: ZCLDataTypes.uint16
            },
            closing_steps: {
                id: 0x6004,
                type: ZCLDataTypes.uint16
            },
            valve_opening_limit_voltage: {
                id: 0x6005,
                type: ZCLDataTypes.uint16
            },
            valve_closing_limit_voltage: {
                id: 0x6006,
                type: ZCLDataTypes.uint16
            },
            valve_motor_running_voltage: {
                id: 0x6007,
                type: ZCLDataTypes.uint16
            },
            valve_opening_degree: {
                id: 0x600b,
                type: ZCLDataTypes.uint8
            },
            valve_closing_degree: {
                id: 0x600c,
                type: ZCLDataTypes.uint8
            },
            ext_temp_value: {
                id: 0x600d,
                type: ZCLDataTypes.int16
            },
            ext_temp_enabled: {
                id: 0x600e,
                type: ZCLDataTypes.uint8
            },
            energy_today: {
                id: 0x7009,
                type: ZCLDataTypes.uint32,
                manufacturerId: 0x1286
            },
            energy_month: {
                id: 0x700a,
                type: ZCLDataTypes.uint32,
                manufacturerId: 0x1286
            },
            energy_yesterday: {
                id: 0x700b,
                type: ZCLDataTypes.uint32,
                manufacturerId: 0x1286
            },
            // Protection settings - individual attributes
            // Based on zigbee-herdsman-converters customClusterEwelink
            max_power: {
                id: 0x7000,
                type: ZCLDataTypes.uint32
            },
            max_current: {
                id: 0x7001,
                type: ZCLDataTypes.uint32
            },
            max_voltage: {
                id: 0x7002,
                type: ZCLDataTypes.uint32
            },
            min_voltage: {
                id: 0x7003,
                type: ZCLDataTypes.uint32
            },
            min_current: {
                id: 0x7004,
                type: ZCLDataTypes.uint32
            },
            min_power: {
                id: 0x7005,
                type: ZCLDataTypes.uint32
            },
            // Enable flags for protection limits
            enable_min_power: {
                id: 0x7006,
                type: ZCLDataTypes.uint8
            },
            // Outlet control protect - prevents remote on/off control
            outlet_control_protect: {
                id: 0x7007,
                type: ZCLDataTypes.uint8
            },
            enable_max_voltage: {
                id: 0x7008,
                type: ZCLDataTypes.uint8
            },
            enable_min_voltage: {
                id: 0x700c,
                type: ZCLDataTypes.uint8
            },
            enable_min_current: {
                id: 0x700d,
                type: ZCLDataTypes.uint8
            },
            // MINI-ZBDIM live power measurements. Confirmed against
            // zigbee-herdsman-converters: this manufacturer cluster reuses
            // IDs 0x7004-0x7006 for a different purpose per device family
            // (protection limits above vs. live readings here) — safe only
            // because no current driver reads/writes the colliding names.
            acCurrentCurrentValue: {
                id: 0x7004,
                type: ZCLDataTypes.uint32
            },
            acCurrentVoltageValue: {
                id: 0x7005,
                type: ZCLDataTypes.uint32
            },
            // int32 (not uint32): MINI-ZB1GSP can report negative power when
            // energy flows in the "export" direction — confirmed against
            // zigbee-herdsman-converters' signedInt32MilliToValue() use for
            // this exact attribute. Safe for import-only devices (MINI-ZBDIM,
            // S60ZBTPF) too: their values never approach the sign bit.
            acCurrentPowerValue: {
                id: 0x7006,
                type: ZCLDataTypes.int32
            },
            // MINI-ZB1GSP bidirectional/cumulative energy counters.
            output_energy_today: {
                id: 0x7018,
                type: ZCLDataTypes.uint32
            },
            output_energy_month: {
                id: 0x7019,
                type: ZCLDataTypes.uint32
            },
            total_energy_consumption: {
                id: 0x701e,
                type: ZCLDataTypes.uint32
            },
            total_output_energy_consumption: {
                id: 0x701f,
                type: ZCLDataTypes.uint32
            },
            // MINI-ZB1GSP "Power Protector" overload-protection settings.
            // Encoded as a raw ZCL ARRAY of UINT8 (see ZCLUint8Array above).
            // Full write payload built by SonoffCluster.createPowerProtectorPayload().
            // Confirmed byte-for-byte against zigbee-herdsman-converters'
            // localFastSceneConfiguration({hasSwitch:true}).
            local_fast_scene_configuration: {
                id: 0x7016,
                type: ZCLUint8Array
            },
            // SNZB-09P siren. Confirmed against zigbee-herdsman-converters
            // PR #12337 (customClusterEwelink extend for this device).
            power_supply_mode: {
                id: 0x0024,
                type: ZCLDataTypes.uint8
                // 0=battery, 1=external
            },
            alarm_light_enable: {
                id: 0x2022,
                type: ZCLDataTypes.bool
            },
            alarm_sound_type: {
                id: 0x2023,
                type: ZCLDataTypes.uint8
                // 0-9, ten built-in sound/tone presets, no further semantics published
            },
            alarm_volume_level: {
                id: 0x2024,
                type: ZCLDataTypes.uint8
                // 0=low, 1=medium, 2=high, 3=highest
            },
            alarm_duration: {
                id: 0x2025,
                type: ZCLDataTypes.uint16
                // seconds, 1-900
            },
            alarm_sound_enable: {
                id: 0x2026,
                type: ZCLDataTypes.bool
            },
        };
    }
}

module.exports = SonoffCluster;