const { Cluster, ZCLDataTypes } = require("zigbee-clusters");

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
            }
        };
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
            detach_relay_mode2: {
                id: 0x0019,
                // BITMAP8. zigbee2mqtt sends this WITHOUT manufacturer-specific
                // framing (no manufacturerCode in the write options) and the
                // device accepts it — adding manufacturerId here actually
                // causes ZBM5 to reject the write with MALFORMED_COMMAND.
                // bit 0 = relay 1 detached, bit 1 = relay 2 detached, bit 2 = relay 3 detached.
                type: ZCLDataTypes.map8('l1', 'l2', 'l3', '_b3', '_b4', '_b5', '_b6', '_b7')
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
        };
    }
}

module.exports = SonoffCluster;