'use strict';

const { ZigBeeDevice } = require('homey-zigbeedriver');
const { Cluster, CLUSTER } = require('zigbee-clusters');

const SonoffOnOffCluster = require('../../lib/SonoffOnOffCluster');
try {
  Cluster.addCluster(SonoffOnOffCluster);
} catch (err) {
  // Cluster might already be registered by another driver
}

class SonoffZBMINI extends ZigBeeDevice {

  async onNodeInit({ zclNode }) {
    this.log('ZBMINI Switch initialized');

    if (this.hasCapability('onoff')) {
      this.registerCapability('onoff', CLUSTER.ON_OFF);
    }

    try {
      const { powerOnBehavior } = await this.zclNode.endpoints[1].clusters.onOff.readAttributes('powerOnBehavior');
      await this.setSettings({ power_on_behavior: powerOnBehavior });
    } catch (e) {
      this.log('Could not read / update device settings', e.message);
    }
  }

  async onSettings({ oldSettings, newSettings, changedKeys }) {
    if (changedKeys.includes('power_on_behavior')) {
      try {
        await this.zclNode.endpoints[1].clusters.onOff.writeAttributes({ powerOnBehavior: newSettings.power_on_behavior });
      } catch (error) {
        this.error('Error updating the power on behavior', error.message);
      }
    }
  }

  async onDeleted() {
    this.log('ZBMINI Switch removed');
  }

}

module.exports = SonoffZBMINI;
