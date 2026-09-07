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

class SonoffMiniZB1GS extends ZigBeeDevice {

  async onNodeInit({ zclNode }) {
    this.log('MINI-ZB1GS Switch initialized');

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
    }

    this.checkAttributes();
  }

  handleActionEvent(value) {
    const action = ACTION_LOOKUP[value];
    if (!action) return;
    this.log('Action event:', action);

    if (action === 'switch_on' || action === 'switch_off') {
      // Physical toggle detected via the dedicated action feed — mirror it
      // onto the onoff capability instead of waiting for a separate report.
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
    const overheated = (faultValue & 0b001) !== 0;
    if (this.hasCapability('alarm_generic')) {
      this.setCapabilityValue('alarm_generic', overheated).catch(this.error);
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
      // Device expects 9 (off) / 20 (on) — not a plain boolean.
      sonoffSettings.turbo_mode = newSettings.turbo_mode ? 20 : 9;
    }

    if (changedKeys.includes('switch_mode')) {
      sonoffSettings.switch_mode = parseInt(newSettings.switch_mode, 10);
    }

    if (changedKeys.includes('delayed_power_on_state')) {
      sonoffSettings.power_on_delay_state = !!newSettings.delayed_power_on_state;
    }

    if (changedKeys.includes('delayed_power_on_time')) {
      // Device expects 0.5s increments
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
      ]);
      if (!data) return;

      const settingsData = {};
      if (data.network_led !== undefined) settingsData.network_indicator = !!data.network_led;
      if (data.turbo_mode !== undefined) settingsData.turbo_mode = data.turbo_mode === 20;
      if (data.switch_mode !== undefined) settingsData.switch_mode = String(data.switch_mode);
      if (data.power_on_delay_state !== undefined) settingsData.delayed_power_on_state = !!data.power_on_delay_state;
      if (data.power_on_delay_time !== undefined) settingsData.delayed_power_on_time = data.power_on_delay_time / 2;
      if (data.detach_relay_mode2 !== undefined) settingsData.detach_relay = !!(data.detach_relay_mode2 && data.detach_relay_mode2.l1);

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
    this.log('MINI-ZB1GS Switch removed');
  }

}

module.exports = SonoffMiniZB1GS;
