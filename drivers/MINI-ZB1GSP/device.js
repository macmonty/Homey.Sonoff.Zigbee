'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { Cluster, CLUSTER } = require('zigbee-clusters');

const SonoffOnOffCluster = require('../../lib/SonoffOnOffCluster');
try {
  Cluster.addCluster(SonoffOnOffCluster);
} catch (err) {
  // Cluster might already be registered by another driver
}

const SonoffCluster = require('../../lib/SonoffCluster');
try {
  Cluster.addCluster(SonoffCluster);
} catch (err) {
  // Cluster might already be registered by another driver
}

const { writeAttributesVerbose } = require('../../lib/zclDebug');

// zigbee-herdsman-converters: detachRelayActionEvent lookup
const ACTION_LOOKUP = {
  1: 'single_click',
  2: 'double_click',
  3: 'long_press',
  4: 'switch_on',
  5: 'switch_off',
};

// zigbee-herdsman-converters: faultCodeMiniZb1gsp({hasSwitch:true}) bit map
const FAULT_BITS = {
  alarm_generic: 0b001,
  'alarm_generic.metering_error': 0b010,
  'alarm_generic.overload_protection': 0b100,
};

class SonoffMiniZB1GSP extends ZigBeeDevice {

  async onNodeInit({ zclNode }) {
    this.log('MINI-ZB1GSP Switch initialized');

    const self = this;

    if (this.hasCapability('onoff')) {
      this.registerCapability('onoff', CLUSTER.ON_OFF);
    }

    const sonoffCluster = zclNode.endpoints[1].clusters[SonoffCluster.NAME];
    if (sonoffCluster) {
      sonoffCluster.on('attr.detach_relay_action_event', (value) => this.handleActionEvent(value));
      sonoffCluster.on('attr.fault_code', (value) => this.handleFaultCode(value));
      sonoffCluster.on('attr.network_led', (value) => {
        if (this.getSetting('network_indicator') !== !!value) {
          this.setSettings({ network_indicator: !!value }).catch(this.error);
        }
      });
      sonoffCluster.on('attr.turbo_mode', (value) => {
        const valBool = value === 20;
        if (this.getSetting('turbo_mode') !== valBool) {
          this.setSettings({ turbo_mode: valBool }).catch(this.error);
        }
      });
      sonoffCluster.on('attr.switch_mode', (value) => {
        const valStr = String(value);
        if (this.getSetting('switch_mode') !== valStr) {
          this.setSettings({ switch_mode: valStr }).catch(this.error);
        }
      });
      sonoffCluster.on('attr.power_on_delay_state', (value) => {
        if (this.getSetting('delayed_power_on_state') !== !!value) {
          this.setSettings({ delayed_power_on_state: !!value }).catch(this.error);
        }
      });
      sonoffCluster.on('attr.power_on_delay_time', (value) => {
        const valSec = value / 2;
        if (this.getSetting('delayed_power_on_time') !== valSec) {
          this.setSettings({ delayed_power_on_time: valSec }).catch(this.error);
        }
      });
      sonoffCluster.on('attr.detach_relay_mode2', (value) => {
        const enabled = !!(value && value.l1);
        if (this.getSetting('detach_relay') !== enabled) {
          this.setSettings({ detach_relay: enabled }).catch(this.error);
        }
      });

      // Live power measurements — manufacturer-specific cluster, NOT the
      // standard Electrical Measurement cluster (confirmed against
      // zigbee-herdsman-converters, same as MINI-ZBDIM/S60ZBTPF). Power can
      // be negative here (export direction), hence the signed int32 type.
      sonoffCluster.on('attr.acCurrentVoltageValue', (value) => {
        self.setCapabilityValue('measure_voltage', value / 1000).catch(self.error);
      });
      sonoffCluster.on('attr.acCurrentPowerValue', (value) => {
        self.setCapabilityValue('measure_power', value / 1000).catch(self.error);
      });
      sonoffCluster.on('attr.acCurrentCurrentValue', (value) => {
        self.setCapabilityValue('measure_current', value / 1000).catch(self.error);
      });

      // Cumulative import/export counters are real running totals reported
      // by the device — unlike S60ZBTPF, no client-side reconstruction needed.
      sonoffCluster.on('attr.total_energy_consumption', (value) => {
        self.setCapabilityValue('meter_power', value / 1000).catch(self.error);
      });
      sonoffCluster.on('attr.total_output_energy_consumption', (value) => {
        self.setCapabilityValue('meter_power.exported', value / 1000).catch(self.error);
      });
      sonoffCluster.on('attr.energy_today', (value) => {
        self.setCapabilityValue('meter_power_today', value / 1000).catch(self.error);
      });
      sonoffCluster.on('attr.energy_month', (value) => {
        self.setCapabilityValue('meter_power_month', value / 1000).catch(self.error);
      });
      sonoffCluster.on('attr.output_energy_today', (value) => {
        self.setCapabilityValue('output_energy_today', value / 1000).catch(self.error);
      });
      sonoffCluster.on('attr.output_energy_month', (value) => {
        self.setCapabilityValue('output_energy_month', value / 1000).catch(self.error);
      });
      sonoffCluster.on('attr.local_fast_scene_configuration', (value) => {
        const scene = SonoffCluster.parsePowerProtectorPayload(value);
        if (!scene) return;
        self.setSettings({
          max_current_protect: scene.maxCurrentProtect,
          max_power_protect: scene.maxPowerProtect,
          max_voltage_protect_enabled: scene.maxVoltageProtectEnabled,
          max_voltage_protect: scene.maxVoltageProtect,
          min_voltage_protect_enabled: scene.minVoltageProtectEnabled,
          min_voltage_protect: scene.minVoltageProtect,
          external_switch_only_recovery: scene.externalSwitchOnlyRecovery,
          auto_recovery: scene.autoRecovery,
        }).catch(self.error);
      });
    }

    if (this._powerPollInterval) {
      this.homey.clearInterval(this._powerPollInterval);
    }
    this.pollPowerMeasurements();
    this._powerPollInterval = this.homey.setInterval(() => {
      this.pollPowerMeasurements();
    }, 60000);

    this.checkAttributes();
  }

  async pollPowerMeasurements() {
    const cluster = this.zclNode.endpoints[1].clusters[SonoffCluster.NAME];
    if (!cluster) return;

    try {
      const data = await cluster.readAttributes([
        'acCurrentVoltageValue', 'acCurrentPowerValue', 'acCurrentCurrentValue',
        'total_energy_consumption', 'total_output_energy_consumption',
        'energy_today', 'energy_month', 'output_energy_today', 'output_energy_month',
      ]);

      if (data.acCurrentVoltageValue !== undefined) await this.setCapabilityValue('measure_voltage', data.acCurrentVoltageValue / 1000);
      if (data.acCurrentPowerValue !== undefined) await this.setCapabilityValue('measure_power', data.acCurrentPowerValue / 1000);
      if (data.acCurrentCurrentValue !== undefined) await this.setCapabilityValue('measure_current', data.acCurrentCurrentValue / 1000);
      if (data.total_energy_consumption !== undefined) await this.setCapabilityValue('meter_power', data.total_energy_consumption / 1000);
      if (data.total_output_energy_consumption !== undefined) await this.setCapabilityValue('meter_power.exported', data.total_output_energy_consumption / 1000);
      if (data.energy_today !== undefined) await this.setCapabilityValue('meter_power_today', data.energy_today / 1000);
      if (data.energy_month !== undefined) await this.setCapabilityValue('meter_power_month', data.energy_month / 1000);
      if (data.output_energy_today !== undefined) await this.setCapabilityValue('output_energy_today', data.output_energy_today / 1000);
      if (data.output_energy_month !== undefined) await this.setCapabilityValue('output_energy_month', data.output_energy_month / 1000);
    } catch (e) {
      this.log('Could not read power/energy measurements:', e.message);
    }
  }

  handleActionEvent(value) {
    const action = ACTION_LOOKUP[value];
    if (!action) return;
    this.log('Action event:', action);

    if (action === 'switch_on' || action === 'switch_off') {
      this.setCapabilityValue('onoff', action === 'switch_on').catch(this.error);
      return;
    }

    const triggerCard = this.homey.flow.getDeviceTriggerCard(`${this.driver.id}:${action}`);
    triggerCard.trigger(this).catch(this.error);
  }

  handleFaultCode(value) {
    if (typeof value !== 'number') return;
    const tlv = value >>> 0;
    const type = (tlv >>> 24) & 0xff;
    const length = (tlv >>> 16) & 0xff;
    if (type !== 0x07 || length !== 0x02) return;

    const faultValue = tlv & 0xffff;
    for (const [capabilityId, bit] of Object.entries(FAULT_BITS)) {
      if (this.hasCapability(capabilityId)) {
        this.setCapabilityValue(capabilityId, (faultValue & bit) !== 0).catch(this.error);
      }
    }
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    this.log('Settings changed:', changedKeys);

    if (changedKeys.includes('power_on_behavior')) {
      try {
        await writeAttributesVerbose(this, this.zclNode.endpoints[1].clusters.onOff, {
          powerOnBehavior: newSettings.power_on_behavior,
        });
      } catch (error) {
        this.error('Error updating power on behavior:', error.message);
      }
    }

    const sonoffSettings = {};

    if (changedKeys.includes('network_indicator')) {
      sonoffSettings.network_led = !!newSettings.network_indicator;
    }

    if (changedKeys.includes('turbo_mode')) {
      sonoffSettings.turbo_mode = newSettings.turbo_mode ? 20 : 9;
    }

    if (changedKeys.includes('switch_mode')) {
      sonoffSettings.switch_mode = parseInt(newSettings.switch_mode, 10);
    }

    if (changedKeys.includes('delayed_power_on_state')) {
      sonoffSettings.power_on_delay_state = !!newSettings.delayed_power_on_state;
    }

    if (changedKeys.includes('delayed_power_on_time')) {
      sonoffSettings.power_on_delay_time = Math.round(newSettings.delayed_power_on_time * 2);
    }

    if (changedKeys.includes('detach_relay')) {
      sonoffSettings.detach_relay_mode2 = newSettings.detach_relay ? 0x01 : 0x00;
    }

    if (Object.keys(sonoffSettings).length > 0) {
      try {
        await writeAttributesVerbose(this, this.zclNode.endpoints[1].clusters[SonoffCluster.NAME], sonoffSettings);
        this.log('SonoffCluster attributes written:', sonoffSettings);
      } catch (err) {
        this.error('Error writing SonoffCluster settings:', err.message);
      }
    }

    if (changedKeys.includes('inching_control') ||
        changedKeys.includes('inching_mode') ||
        changedKeys.includes('inching_time')) {
      await this.setInchingControl(newSettings);
    }

    const POWER_PROTECTOR_KEYS = [
      'max_current_protect', 'max_power_protect',
      'max_voltage_protect_enabled', 'max_voltage_protect',
      'min_voltage_protect_enabled', 'min_voltage_protect',
      'external_switch_only_recovery', 'auto_recovery',
    ];
    if (changedKeys.some((k) => POWER_PROTECTOR_KEYS.includes(k))) {
      await this.setPowerProtector(newSettings);
    }
  }

  async setPowerProtector(settings) {
    try {
      const payload = SonoffCluster.createPowerProtectorPayload({
        maxCurrentProtect: settings.max_current_protect,
        maxPowerProtect: settings.max_power_protect,
        maxVoltageProtectEnabled: settings.max_voltage_protect_enabled,
        maxVoltageProtect: settings.max_voltage_protect,
        minVoltageProtectEnabled: settings.min_voltage_protect_enabled,
        minVoltageProtect: settings.min_voltage_protect,
        externalSwitchOnlyRecovery: settings.external_switch_only_recovery,
        autoRecovery: settings.auto_recovery,
      });
      await writeAttributesVerbose(this, this.zclNode.endpoints[1].clusters[SonoffCluster.NAME], {
        local_fast_scene_configuration: payload,
      });
      this.log('Power protector written:', payload.toString('hex'));
    } catch (error) {
      this.error('Error writing power protector:', error.message || error);
    }
  }

  async setInchingControl(settings) {
    try {
      const enabled = settings.inching_control || false;
      const mode = settings.inching_mode || 'off';
      const time = settings.inching_time || 0.5;

      const payload = SonoffCluster.createInchingPayload(enabled, mode, time);
      this.log('Setting inching control:', { enabled, mode, time, payload: payload.toString('hex') });

      await this.zclNode.endpoints[1].clusters[SonoffCluster.NAME].setInching({ data: payload });
      this.log('Inching control set successfully');
    } catch (error) {
      this.error('Error setting inching control:', error);
    }
  }

  async checkAttributes() {
    try {
      const data = await this.zclNode.endpoints[1].clusters.onOff.readAttributes(['powerOnBehavior']);
      if (data && data.powerOnBehavior !== undefined) {
        await this.setSettings({ power_on_behavior: data.powerOnBehavior });
      }
    } catch (e) {
      this.log('Device offline at startup, skipping attribute sync:', e.message);
      return;
    }

    try {
      const cluster = this.zclNode.endpoints[1].clusters[SonoffCluster.NAME];
      const data = await cluster.readAttributes([
        'network_led',
        'turbo_mode',
        'switch_mode',
        'power_on_delay_state',
        'power_on_delay_time',
        'detach_relay_mode2',
        'fault_code',
        'local_fast_scene_configuration',
      ]);
      if (!data) return;

      const settingsData = {};
      if (data.network_led !== undefined) settingsData.network_indicator = !!data.network_led;
      if (data.turbo_mode !== undefined) settingsData.turbo_mode = data.turbo_mode === 20;
      if (data.switch_mode !== undefined) settingsData.switch_mode = String(data.switch_mode);
      if (data.power_on_delay_state !== undefined) settingsData.delayed_power_on_state = !!data.power_on_delay_state;
      if (data.power_on_delay_time !== undefined) settingsData.delayed_power_on_time = data.power_on_delay_time / 2;
      if (data.detach_relay_mode2 !== undefined) settingsData.detach_relay = !!(data.detach_relay_mode2 && data.detach_relay_mode2.l1);

      if (data.local_fast_scene_configuration !== undefined) {
        const scene = SonoffCluster.parsePowerProtectorPayload(data.local_fast_scene_configuration);
        if (scene) {
          settingsData.max_current_protect = scene.maxCurrentProtect;
          settingsData.max_power_protect = scene.maxPowerProtect;
          settingsData.max_voltage_protect_enabled = scene.maxVoltageProtectEnabled;
          settingsData.max_voltage_protect = scene.maxVoltageProtect;
          settingsData.min_voltage_protect_enabled = scene.minVoltageProtectEnabled;
          settingsData.min_voltage_protect = scene.minVoltageProtect;
          settingsData.external_switch_only_recovery = scene.externalSwitchOnlyRecovery;
          settingsData.auto_recovery = scene.autoRecovery;
        }
      }

      if (Object.keys(settingsData).length > 0) {
        await this.setSettings(settingsData);
      }

      if (data.fault_code !== undefined) {
        this.handleFaultCode(data.fault_code);
      }
    } catch (e) {
      this.log('Could not read SonoffCluster attributes:', e.message);
    }
  }

  async onDeleted() {
    this.log('MINI-ZB1GSP Switch removed');
  }

}

module.exports = SonoffMiniZB1GSP;
