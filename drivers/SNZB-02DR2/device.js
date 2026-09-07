'use strict';

const { BoundCluster } = require('zigbee-clusters');
const TempHumiditySensor2 = require('../temphumidutysensor2');
const SonoffTimeBoundCluster = require('../../lib/SonoffTimeBoundCluster');
const SonoffCluster = require('../../lib/SonoffCluster');

class IdentifyBoundCluster extends BoundCluster {
  constructor(device) {
    super();
    this._device = device;
  }

  async handleFrame(frame) {
    if (frame.cmdId === 0) {
      this._device._onIdentify();
    }
  }
}

class SonoffSNZB02DR2 extends TempHumiditySensor2 {

  async onNodeInit({ zclNode }) {
    zclNode.endpoints[1].bind('identify', new IdentifyBoundCluster(this));
    zclNode.endpoints[1].bind('time', new SonoffTimeBoundCluster(zclNode.endpoints[1]));

    // Firmware updates are handled natively by Homey via driver.firmware.compose.json.

    await super.onNodeInit({ zclNode });

    this._buttonTrigger = this.homey.flow.getDeviceTriggerCard(`${this.driver.id}:button_pressed`);

    this.homey.flow.getActionCard('snzb02dr2_set_ext_temp')
      .registerRunListener(async (args) => {
        await args.device.setExternalTemperature(args.temperature);
      });

    this.homey.flow.getActionCard('snzb02dr2_clear_ext_temp')
      .registerRunListener(async (args) => {
        await args.device.clearExternalTemperature();
      });
  }

  async syncDisplaySettings() {
    const cluster = this.zclNode.endpoints[1].clusters[SonoffCluster.NAME];
    if (!cluster) return;

    const s = this.getSettings();
    await cluster.writeAttributes({
      temperature_unit:        parseInt(s.temperature_unit) || 0,
      comfort_temperature_min: Math.round((s.comfort_temperature_min || 18) * 100),
      comfort_temperature_max: Math.round((s.comfort_temperature_max || 26) * 100),
      comfort_humidity_min:    Math.round((s.comfort_humidity_min || 40) * 100),
      comfort_humidity_max:    Math.round((s.comfort_humidity_max || 60) * 100),
    });
    this.log('Display settings synced to device');
  }

  _onIdentify() {
    this.log('Identify received — button pressed');
    if (this._buttonTrigger) {
      this._buttonTrigger.trigger(this).catch(this.error.bind(this));
    }
    if (!this._pendingDisplaySync) return;
    this._pendingDisplaySync = false;
    this.syncDisplaySettings().catch(this.error.bind(this));
    this.log('Applying pending display settings');
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    await super.onSettings({ oldSettings, newSettings, changedKeys });

    const displayKeys = ['temperature_unit', 'comfort_temperature_min', 'comfort_temperature_max', 'comfort_humidity_min', 'comfort_humidity_max'];
    if (changedKeys.some(k => displayKeys.includes(k))) {
      this._pendingDisplaySync = true;
      return this.homey.__('settings.press_button');
    }
  }

  async clearExternalTemperature() {
    const cluster = this.zclNode.endpoints[1].clusters[SonoffCluster.NAME];
    if (!cluster) {
      this.error('SonoffCluster not available');
      return;
    }
    await cluster.writeAttributes({ ext_temp_enabled: 0 });
    this.log('External temperature cleared');
  }

  async setExternalTemperature(celsius) {
    const value = Math.round(celsius * 10) * 10;
    if (this._lastExtTemp === value) return;
    this._lastExtTemp = value;

    const cluster = this.zclNode.endpoints[1].clusters[SonoffCluster.NAME];
    if (!cluster) {
      this.error('SonoffCluster not available');
      return;
    }
    await cluster.writeAttributes({ ext_temp_value: value });
    await cluster.writeAttributes({ ext_temp_enabled: 1 });
    this.log('External temperature set to', celsius, '°C');
  }

}

module.exports = SonoffSNZB02DR2;
